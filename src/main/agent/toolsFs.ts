import { dirname } from 'node:path'
import { TOOL_LABELS } from '@shared/types'
import { cap } from './toolSummarize'
import { Type, defineTool, failure, type ToolHost } from './toolHost'
import { fsReadErrorHint, resolveInWorkdir, textWindowPrefix } from './toolPaths'
import { unifiedDiff } from './diff'

export function createFsTools(host: ToolHost) {
  const inWorkdir = (path: string): string => resolveInWorkdir(host.workdir, path)

  const fsRead = defineTool({
    name: 'fs_read',
    label: TOOL_LABELS.fs_read,
    description:
      'Read a UTF-8 text file by byte window (default first ~2MB). Pass start_byte / max_bytes to page further — large files are never refused. Relative paths resolve against the workdir. For PDF/DOCX/XLSX/PPTX/CSV prefer doc_search / doc_fetch (or sql_query for CSV/TSV/Parquet/SQLite analysis). Images, audio, video, and other binaries are not readable as text.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' }),
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
      'Create or overwrite a UTF-8 text file, creating parent directories as needed. Relative paths resolve against the conversation working directory. Do not use for .docx/.xlsx/.pptx/.pdf (would corrupt them) — use officecli or the pdf skill instead.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' }),
      content: Type.String({ description: 'Full file contents to write.' })
    }),
    async execute(_id, params) {
      const path = inWorkdir(params.path)
      const previous = await host.files.readTextFile(path, host.conversationId)
      const before = previous.error || previous.truncated ? null : previous.content

      const result = await host.files.writeTextFile(path, params.content, host.conversationId)
      if (!result.ok) return failure(result.error ?? '写入失败')
      const logical = host.files.workingCopies?.logicalPath(path) ?? path
      host.fsChanged(dirname(logical), logical)
      if (!previous.truncated) {
        host.recordWrite?.(path, before, params.content)
      }

      const written = `已写入 ${path}（${params.content.length} 字符）`
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
    description: 'List one directory level. Ignores .git, node_modules and .DS_Store.',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: 'Directory path; defaults to the workdir.' })
      )
    }),
    async execute(_id, params) {
      const listing = await host.files.listDirectory(
        inWorkdir(params.path ?? '.'),
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
