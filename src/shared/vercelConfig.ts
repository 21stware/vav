/** Local Vercel project files (no filesystem). */

export function isVercelConfigName(name: string): boolean {
  return /^vercel\.json$/i.test(name)
}

export function isVercelProjectFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  return /(^|\/)\.vercel\/project\.json$/i.test(normalized) || isVercelConfigName(normalized.split('/').pop() ?? '')
}

export function parseVercelProjectName(source: string): string | null {
  try {
    const json = JSON.parse(source) as { name?: unknown; projectId?: unknown }
    if (typeof json.name === 'string' && json.name.trim()) return json.name.trim()
    if (typeof json.projectId === 'string' && json.projectId.trim()) return json.projectId.trim()
  } catch {
    // ignore
  }
  return null
}
