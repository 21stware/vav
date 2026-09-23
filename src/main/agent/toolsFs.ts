import { dirname } from 'node:path'
import { ARTIFACT_MARKER } from '@shared/conversationArtifacts'
import { isAppCatalogUrl, parseAppResourceUrl } from '@shared/appResourceUrl'
import { TOOL_LABELS } from '@shared/types'
import { cap } from './toolSummarize'
import { Type, defineTool, failure, type ToolHost } from './toolHost'
import { fsReadErrorHint, resolveInWorkdir, textWindowPrefix } from './toolPaths'
import { resolveAppToolPath } from './toolsApp'
import { unifiedDiff } from './diff'

export function createFsTools(host: ToolHost) {
  const inWorkdir = (path: string): string => resolveAppToolPath(host, path) ?? resolveInWorkdir(host.workdir, path)

  const fsRead = defineTool({
    name: 'fs_read',
    label: TOOL_LABELS.fs_read,
    description:
      'Read a UTF-8 text file by byte window (default first ~2MB). Pass start_byte / max_bytes to page further — large files are never refused. Relative paths resolve against the workdir. `vav://app/…` URLs from the app column also work. For PDF/DOCX/XLSX/PPTX/CSV prefer doc_search / doc_fetch (or sql_query for CSV/TSV/Parquet/SQLite analysis). Images, audio, video, and other binaries are not readable as text.',
    parameters: Type.Object({
      path: Type.String({
        description: 'File path (absolute, workdir-relative, or vav://app/… URL).'
      }),
      start_byte: Type.Optional(
        Type.Number({ description: 'Byte offset to start reading (default 0).' })
      ),
      max_bytes: Type.Optional(
        Type.Number({
          description: 'Max bytes to return in this window (default ~2MB, hard max 16MB).'
        })
      )
    }),
    async execute(_id, params) {
      const path = inWorkdir(params.path)
      const startByte =
        params.start_byte != null ? Math.max(0, Math.floor(Number(params.start_byte))) : 0
      const maxBytes =
        params.max_bytes != null ? Math.floor(Number(params.max_bytes)) : undefined
      const result = await host.files.readTextWindow(path, {
        startByte,
        maxBytes,
        conversationId: host.conversationId
      })
      if (result.error) {
        return failure(`${result.error}${fsReadErrorHint(String(params.path ?? ''), result.error)}`)
      }
      const body = textWindowPrefix(result) + result.content
      return {
        content: [{ type: 'text', text: cap(body) }],
        details: { display: body }
      }
    }
  })

  const fsWrite = defineTool({
    name: 'fs_write',
    label: TOOL_LABELS.fs_write,
    description:
      `Create or overwrite a UTF-8 text file in the working directory, creating parent directories as needed. Relative paths resolve against that directory. This tool is workspace files only: source, config, and file deliverables (report, brief, HTML, slides). Do not use for .docx/.xlsx/.pptx/.pdf. App objects are not files: a Note is note_write / note_edit, an Analysis dataset is analysis_write / analysis_edit, a schedule is schedule_write / schedule_edit, and a Storage catalog file is storage_write / storage_edit. For a workspace file deliverable that is not a source edit, put \`${ARTIFACT_MARKER}\` near the top and/or pass artifact: true.`,
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' }),
      content: Type.String({ description: 'Full file contents to write.' }),
      artifact: Type.Optional(
        Type.Boolean({
          description:
            `Mark this write as a user-facing artifact (a deliberate document). Ordinary source edits must omit this. Prefer also putting ${ARTIFACT_MARKER} near the top of text documents.`
        })
      )
    }),
    async execute(_id, params) {
      const path = inWorkdir(params.path)
      const logical = host.files.workingCopies?.logicalPath(path) ?? path
      const note = host.knowledge
        ?.searchTargets()
        .find((row) => row.kind === 'note' && (row.path === path || row.path === logical))
      if (note) {
        return failure(
          `“${note.title}” is a Note (${note.id}). Rewrite it with note_edit host_id "${note.id}". Create a different note with note_write. fs_write does not write notes.`
        )
      }
      const dataset = host.appResources
        ?.list('data')
        .find((row) => row.path && (row.path === path || row.path === logical))
      if (dataset) {
        return failure(
          `“${dataset.title}” is an Analysis dataset. Update it with analysis_edit${dataset.url ? ` url "${dataset.url}"` : ''}. Create another with analysis_write. fs_write does not write analysis objects.`
        )
      }
      const previous = await host.files.readTextFile(path, host.conversationId)
      const before = previous.error || previous.truncated ? null : previous.content

      const result = await host.files.writeTextFile(path, params.content, host.conversationId)
      if (!result.ok) return failure(result.error ?? '写入失败')
      host.fsChanged(dirname(logical), logical)
      if (!previous.truncated) {
        host.recordWrite?.(path, before, params.content)
      }

      const written = `已写入 ${logical}（${params.content.length} 字符）`
      const diff = previous.truncated ? null : unifiedDiff(before, params.content)
      return {
        content: [{ type: 'text', text: `Wrote ${path} (${params.content.length} chars)` }],
        details: { display: diff ?? (before === params.content ? `${written}，内容未变化` : written) }
      }
    }
  })

  const fsList = defineTool({
    name: 'fs_list',
    label: TOOL_LABELS.fs_list,
    description:
      'List one directory level. Ignores .git, node_modules and .DS_Store. Pass vav://app or vav://app/storage|data|knowledge|scheduled to list app-column resources.',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: 'Directory path, or a vav://app/… catalog URL. Defaults to the workdir.'
        })
      )
    }),
    async execute(_id, params) {
      const raw = String(params.path ?? '').trim()
      const ref = parseAppResourceUrl(raw)
      if (host.appResources && (isAppCatalogUrl(raw) || (ref && !ref.path && !ref.id))) {
        const rows = host.appResources.list(ref?.kind)
        const text =
          rows.map((row) => `- ${row.title}\n  ${row.url}`).join('\n') || '(empty)'
        return { content: [{ type: 'text', text: cap(text) }], details: { display: text } }
      }
      const listing = await host.files.listDirectory(
        inWorkdir(raw || '.'),
        'name',
        true,
        host.conversationId
      )
      if (listing.error) return failure(listing.error)
      const lines = listing.entries.map((e) => `${e.isDirectory ? 'd' : '-'} ${e.name}`)
      if (listing.truncated) lines.push(`… ${listing.truncated} more`)
      const text = lines.join('\n') || '(空文件夹)'
      return { content: [{ type: 'text', text: cap(text) }], details: { display: text } }
    }
  })

  return [fsRead, fsWrite, fsList]
}
