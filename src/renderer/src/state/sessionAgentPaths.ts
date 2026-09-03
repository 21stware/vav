const WORKSPACE_AGENT_KEY = 'vav.workspaceAgentByPath'
const PREVIEW_AGENT_KEY = 'vav.previewAgentByPath'

function loadPathMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function savePathMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function loadWorkspaceAgents(): Record<string, string> {
  return loadPathMap(WORKSPACE_AGENT_KEY)
}

export function saveWorkspaceAgents(map: Record<string, string>): void {
  savePathMap(WORKSPACE_AGENT_KEY, map)
}

export function loadPreviewAgents(): Record<string, string> {
  return loadPathMap(PREVIEW_AGENT_KEY)
}

export function savePreviewAgents(map: Record<string, string>): void {
  savePathMap(PREVIEW_AGENT_KEY, map)
}
