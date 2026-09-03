import { TOOL_LABELS } from '@shared/types'
import { cap } from './toolSummarize'
import { Type, defineTool, failure, type ToolHost } from './toolHost'

export function createWebTools(host: ToolHost) {
  const webSearch = defineTool({
    name: 'web_search',
    label: TOOL_LABELS.web_search,
    description:
      'Search the public web from this machine (no VAV cloud proxy). Returns ranked hits with title, url, and snippet. Prefer this over guessing URLs; then use web_fetch on the best results. Localhost / private IPs are blocked for general browsing — optional SearXNG base URL in settings is the exception for search only.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query (keywords or natural language).' }),
      num_results: Type.Optional(
        Type.Number({ description: 'How many results to return (default 8, max 12).' })
      ),
      site: Type.Optional(
        Type.String({
          description: 'Optional host to restrict results (site: filter), e.g. "developer.mozilla.org".'
        })
      )
    }),
    async execute(_id, params, signal) {
      if (!host.webSearch) return failure('Web search is unavailable')
      const query = String(params.query ?? '').trim()
      if (!query) return failure('Missing query')
      const settings = host.settings()
      const result = await host.webSearch.search({
        query,
        numResults: params.num_results != null ? Number(params.num_results) : undefined,
        site: params.site != null ? String(params.site) : undefined,
        timeoutMs: settings.webTimeoutMs,
        searxngBaseUrl: settings.webSearxngBaseUrl || undefined,
        braveApiKey: host.braveSearchKey?.() || undefined,
        tinyfishApiKey: host.tinyfishSearchKey?.() || undefined,
        provider: settings.webSearchProvider,
        signal
      })
      if (!result.ok) {
        return failure(host.webSearch.formatForModel(result))
      }
      const text = host.webSearch.formatForModel(result)
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: { display: host.webSearch.formatForDisplay(result) }
      }
    }
  })

  const webFetch = defineTool({
    name: 'web_fetch',
    label: TOOL_LABELS.web_fetch,
    description:
      'Fetch a public http(s) URL and return readable text (HTML → main article markdown when possible). Use after web_search or when the user gives a URL. Blocks private/localhost addresses. Prefer this over terminal curl for reading pages.',
    parameters: Type.Object({
      url: Type.String({ description: 'Absolute http(s) URL to fetch.' }),
      extract: Type.Optional(
        Type.String({
          description:
            'auto (default: HTML→markdown via Readability), markdown, text, or raw (no extract).'
        })
      ),
      max_chars: Type.Optional(
        Type.Number({
          description: 'Max characters of body returned (default 12000, hard max 40000).'
        })
      ),
      start_line: Type.Optional(
        Type.Number({ description: '1-based line offset into the extracted body for long pages.' })
      )
    }),
    async execute(_id, params, signal) {
      if (!host.webFetch) return failure('Web fetch is unavailable')
      const url = String(params.url ?? '').trim()
      if (!url) return failure('Missing url')
      const extractRaw = params.extract != null ? String(params.extract) : 'auto'
      const extract =
        extractRaw === 'markdown' ||
        extractRaw === 'text' ||
        extractRaw === 'raw' ||
        extractRaw === 'auto'
          ? extractRaw
          : 'auto'
      const settings = host.settings()
      const result = await host.webFetch.fetch({
        url,
        extract,
        maxChars: params.max_chars != null ? Number(params.max_chars) : undefined,
        startLine: params.start_line != null ? Number(params.start_line) : undefined,
        timeoutMs: settings.webTimeoutMs,
        allowRender: settings.webFetchAllowRender,
        tinyfishApiKey: host.tinyfishSearchKey?.() || undefined,
        signal
      })
      const text = host.webFetch.formatForModel(result)
      if (!result.ok) {
        return failure(text)
      }
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: { display: text }
      }
    }
  })

  return [webSearch, webFetch] as const
}
