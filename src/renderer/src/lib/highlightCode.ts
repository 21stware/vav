import hljs from 'highlight.js/lib/common'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Extension → highlight.js language id (common build). */
const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.pyw': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.r': 'r',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.json': 'json',
  '.jsonc': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'ini',
  '.xml': 'xml',
  '.html': 'xml',
  '.htm': 'xml',
  '.svg': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.vue': 'xml',
  '.svelte': 'xml',
  '.astro': 'xml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.dockerfile': 'dockerfile',
  '.rpml': 'xml'
}

export function languageFromPath(path: string): string | undefined {
  const base = path.split(/[/\\]/).pop() ?? path
  const lower = base.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return undefined
  return EXT_LANG[lower.slice(dot)]
}

/**
 * Highlight source to HTML spans. Falls back to escaped plain text.
 * Auto-detect only for modest buffers — full-file highlightAuto is expensive.
 */
export function highlightCode(source: string, language?: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(source, { language, ignoreIllegals: true }).value
    } catch {
      // fall through
    }
  }
  // Auto-detect only for multi-line buffers. Virtualized code highlights
  // one line at a time — highlightAuto on a single license/prose line picks
  // a random language and rainbow-colors the text.
  if (source.length > 0 && source.length < 80_000 && source.includes('\n')) {
    try {
      return hljs.highlightAuto(source).value
    } catch {
      // fall through
    }
  }
  return escapeHtml(source)
}
