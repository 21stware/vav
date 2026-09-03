import { basename, extname } from 'node:path'
import { TOOL_LABELS } from '@shared/types'
import { duckDbKindForPath } from '../fs/DuckDbService'
import { cap } from './toolSummarize'
import { Type, defineTool, failure, type ToolHost } from './toolHost'
import { buildSelectionAnchor, resolveDocPath } from './toolPaths'

export function createDocTools(host: ToolHost) {
  const docSearch = defineTool({
    name: 'doc_search',
    label: TOOL_LABELS.doc_search,
    description:
      'Search inside a PDF, Word, Excel, PowerPoint, CSV/TSV, or text document using local retrieval (BM25 + structure). Prefer this over fs_read for binary office/PDF files. PDF indexing uses the extractable text layer only (no OCR). Not for images/audio/video. Use related_to_selection=true to expand around the user\'s selected preview blocks.',
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: 'Keywords or natural-language query. Optional when related_to_selection is true.'
        })
      ),
      path: Type.Optional(
        Type.String({
          description:
            'Document path (absolute or workdir-relative). Defaults to the file-session document or the first selection path.'
        })
      ),
      top_k: Type.Optional(
        Type.Number({ description: 'How many chunks to return (default 8, max 20).' })
      ),
      related_to_selection: Type.Optional(
        Type.Boolean({
          description:
            'When true, rank by proximity/overlap with the user\'s selected context from this turn.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.retrieval) return failure('Document retrieval is unavailable')
      const path = resolveDocPath(host, params.path)
      if (!path) {
        return failure(
          'No document path. Pass path=… or open a file session / select content in the preview.'
        )
      }
      const query = String(params.query ?? '').trim()
      const related = params.related_to_selection === true
      if (!query && !related) {
        return failure('Provide query and/or related_to_selection=true')
      }
      const anchor = related ? buildSelectionAnchor(host) : undefined
      if (related && !anchor?.text && !(anchor?.blockIds?.length)) {
        // Still allow neighbor-less BM25 if query present
        if (!query) {
          return failure('related_to_selection=true but no selected context on this turn')
        }
      }
      const result = await host.retrieval.search({
        path,
        query: query || (anchor?.text ?? ''),
        topK: params.top_k != null ? Number(params.top_k) : undefined,
        anchor,
        mode: related ? 'related' : 'search'
      })
      if (result.error) return failure(result.error)
      if (result.hits.length === 0) {
        const warn = result.meta?.warnings?.join('; ')
        return {
          content: [
            {
              type: 'text',
              text: `No matching chunks in ${basename(path)}.${warn ? ` (${warn})` : ''}`
            }
          ],
          details: { display: `无匹配 · ${path}` }
        }
      }
      const modelLines = [
        `Found ${result.hits.length} chunk(s) in ${basename(path)}` +
          (result.meta ? ` · ${result.meta.chunkCount} indexed` : '') +
          (result.meta?.warnings?.length ? ` · ${result.meta.warnings.join('; ')}` : ''),
        ''
      ]
      const displayLines = [...modelLines]
      result.hits.forEach((hit, i) => {
        const loc =
          hit.chunk.page != null
            ? `Page ${hit.chunk.page}`
            : hit.chunk.sectionId ?? hit.chunk.kind
        const head = `${i + 1}. [doc:${hit.chunk.id} | ${basename(path)} | ${loc}] score=${hit.score} (${hit.reasons.join('+')})`
        modelLines.push(head)
        modelLines.push(`   ${hit.snippet}`)
        modelLines.push('')
        displayLines.push(head)
        displayLines.push(hit.chunk.text)
        displayLines.push('')
      })
      return {
        content: [{ type: 'text', text: cap(modelLines.join('\n')) }],
        details: { display: displayLines.join('\n') }
      }
    }
  })

  const docFetch = defineTool({
    name: 'doc_fetch',
    label: TOOL_LABELS.doc_fetch,
    description:
      'Fetch full text for document chunks by id (from doc_search), or all chunks on a page / section. Use after doc_search when you need the complete passage.',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: 'Document path; defaults like doc_search.'
        })
      ),
      ids: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Chunk or block ids returned by doc_search (max 20).'
        })
      ),
      page: Type.Optional(Type.Number({ description: '1-based PDF page to fetch.' })),
      section_id: Type.Optional(
        Type.String({ description: 'Structured section id (e.g. page-3, sheet name).' })
      )
    }),
    async execute(_id, params) {
      if (!host.retrieval) return failure('Document retrieval is unavailable')
      const path = resolveDocPath(host, params.path)
      if (!path) {
        return failure(
          'No document path. Pass path=… or open a file session / select content in the preview.'
        )
      }
      const ids = Array.isArray(params.ids) ? params.ids.map(String).slice(0, 20) : undefined
      const result = await host.retrieval.fetch({
        path,
        ids,
        page: params.page != null ? Number(params.page) : undefined,
        sectionId: params.section_id != null ? String(params.section_id) : undefined
      })
      if (result.error) return failure(result.error)
      if (result.chunks.length === 0) {
        return {
          content: [{ type: 'text', text: `No chunks matched in ${basename(path)}.` }],
          details: { display: `无块 · ${path}` }
        }
      }
      const lines: string[] = [
        `Fetched ${result.chunks.length} chunk(s) from ${basename(path)}`,
        ''
      ]
      for (const c of result.chunks) {
        const loc = c.page != null ? `Page ${c.page}` : c.sectionId ?? c.kind
        lines.push(`[doc:${c.id} | ${basename(path)} | ${loc}]`)
        lines.push(c.text)
        lines.push('')
      }
      const text = lines.join('\n')
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: { display: text }
      }
    }
  })

  const sqlQuery = defineTool({
    name: 'sql_query',
    label: TOOL_LABELS.sql_query,
    description:
      'Run read-only analytical SQL (DuckDB dialect) over a SQLite, CSV, TSV, or Parquet file (not .xlsx/.xls). The file is attached in-memory; tables from a SQLite DB or a single CSV/TSV/Parquet file are queryable by name. Use this for analysis (aggregation, GROUP BY, JOIN, window functions) instead of paging the DB preview. Run `SHOW TABLES` first to list available tables, or `DESCRIBE <table>` for columns. For Excel workbooks use doc_search or officecli/xlsx instead.',
    parameters: Type.Object({
      sql: Type.String({
        description:
          'DuckDB SQL statement. SELECT / SHOW / DESCRIBE / WITH / EXPLAIN are expected. DDL that mutates the source file is not possible (in-memory attach).'
      }),
      path: Type.Optional(
        Type.String({
          description:
            'File path (.db/.sqlite/.sqlite3/.db3/.csv/.tsv/.parquet), absolute or workdir-relative. Defaults to the file-session document.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.duckdb) return failure('DuckDB is unavailable')
      const path = resolveDocPath(host, params.path)
      if (!path) {
        return failure(
          'No file path. Pass path=… or open a file session for a SQLite/CSV/TSV/Parquet file.'
        )
      }
      const sql = String(params.sql ?? '').trim()
      if (!sql) return failure('Missing sql parameter')

      const kind = duckDbKindForPath(path)
      if (!kind) {
        return failure(
          `Unsupported file type for sql_query: ${extname(path) || basename(path)}. Use .db/.sqlite/.csv/.tsv/.parquet.`
        )
      }

      const lower = sql.toLowerCase()
      const isSchema =
        lower.startsWith('show ') ||
        lower.startsWith('describe ') ||
        lower.startsWith('pragma ') ||
        lower === 'show tables'

      const result = await host.duckdb.query(path, sql)
      if (result.error) {
        return {
          content: [{ type: 'text', text: `SQL error: ${result.error}` }],
          details: { display: `✗ ${basename(path)} · ${result.error}` }
        }
      }

      const header = result.columns.join(' | ')
      const sep = result.columns.map(() => '---').join(' | ')
      const dataRows = result.rows.map((r) => r.join(' | '))
      const modelLines = [
        `${basename(path)} (${kind}) · ${result.rowCount} row(s)${
          result.truncated ? ` (truncated to ${result.rows.length})` : ''
        }`,
        header,
        sep,
        ...dataRows
      ]
      const displayLines = [
        `${basename(path)} (${kind}) · ${result.rowCount} row(s)${
          result.truncated ? ` (truncated to ${result.rows.length})` : ''
        }`,
        header,
        ...result.rows.map((r) => r.join(' | '))
      ]
      const text = cap(modelLines.join('\n'))
      const summary = isSchema
        ? `schema · ${basename(path)}`
        : `${result.rowCount} row(s) · ${basename(path)}`
      return {
        content: [{ type: 'text', text }],
        details: { display: displayLines.join('\n'), summary }
      }
    }
  })

  return [docSearch, docFetch, sqlQuery] as const
}
