/**
 * Tray and remote-dir labels: home as `~`, otherwise the last path segment.
 * Pure so tests do not need Electron or the settings store.
 */
export function trayDirLabel(
  workingDirectory: string | null | undefined,
  home: string
): string {
  if (!workingDirectory || workingDirectory === '~') return '~'
  if (workingDirectory === home) return '~'
  if (workingDirectory.startsWith(home + '/') || workingDirectory.startsWith(home + '\\')) {
    return `~${workingDirectory.slice(home.length).replace(/\\/g, '/')}`
  }
  const parts = workingDirectory.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : workingDirectory
}

export function trayAgentLabel(
  agentId: string,
  agents: { id: string; name?: string }[] | undefined
): string {
  const fromSettings = agents?.find((a) => a.id === agentId)
  if (fromSettings?.name) return fromSettings.name
  return agentId
}

/** First non-empty name for a CLI agent pane in the tray. */
export function pickAgentSessionTitle(opts: {
  swarmName?: string | null
  bindingTitle?: string | null
  conversationTitle?: string | null
  sessionTitle?: string | null
  conversationId: string
}): string {
  return (
    opts.swarmName?.trim() ||
    opts.bindingTitle?.trim() ||
    opts.conversationTitle?.trim() ||
    opts.sessionTitle ||
    opts.conversationId
  )
}
