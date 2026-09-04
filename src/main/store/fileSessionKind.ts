/**
 * Extension → system-prompt playbook kind. Used by AgentRuntime without
 * loading FileSessionStore (which needs Electron userData).
 * null = ordinary text/code (use the generic open-file playbook).
 */
export function kindFromFilePath(path: string): string | null {
  const base = path.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'text'
  const ext = base.slice(dot).toLowerCase()
  if (ext === '.zip') return 'zip'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (/\.(docx|xlsx|xls|pptx|ppt)$/i.test(ext)) return 'office'
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|tif|tiff|avif)$/i.test(ext)) return 'image'
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(ext)) return 'audio'
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(ext)) return 'video'
  if (/\.(db|sqlite|sqlite3|db3)$/i.test(ext)) return 'sqlite'
  if (ext === '.parquet') return 'parquet'
  const knownText =
    /\.(md|markdown|mdx|txt|json|js|ts|tsx|jsx|py|rs|go|swift|ipynb|html|css|xml|yml|yaml|toml|sh|zsh)$/i.test(
      ext
    )
  if (knownText) return null
  return 'binary'
}
