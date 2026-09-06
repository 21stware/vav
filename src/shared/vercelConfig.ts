/** Parse local Vercel project files without touching the network. */

export function isVercelConfigName(name: string): boolean {
  return name === 'vercel.json' || name === 'vercel.jsonc'
}

export function parseVercelProjectJson(source: string): {
  projectId: string | null
  orgId: string | null
  projectName: string | null
} {
  try {
    const json = JSON.parse(source) as {
      projectId?: unknown
      orgId?: unknown
      projectName?: unknown
    }
    return {
      projectId: typeof json.projectId === 'string' ? json.projectId : null,
      orgId: typeof json.orgId === 'string' ? json.orgId : null,
      projectName: typeof json.projectName === 'string' ? json.projectName : null
    }
  } catch {
    return { projectId: null, orgId: null, projectName: null }
  }
}

export function parseVercelJsonName(source: string): string | null {
  try {
    const json = JSON.parse(source) as { name?: unknown }
    return typeof json.name === 'string' && json.name.trim() ? json.name.trim() : null
  } catch {
    return null
  }
}
