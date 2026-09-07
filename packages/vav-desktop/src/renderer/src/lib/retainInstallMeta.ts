import type { TerminalTab } from '@shared/types'

/** Hydrate rebuilds tabs from PTY metas — keep install labels from local state. */
export function retainInstallMeta(tabs: TerminalTab[], previous: TerminalTab[]): TerminalTab[] {
  if (previous.length === 0) return tabs
  const prev = new Map(previous.map((t) => [t.id, t]))
  return tabs.map((t) => {
    const p = prev.get(t.id)
    if (!p || p.purpose !== 'install') return t
    return {
      ...t,
      purpose: 'install',
      installAgentId: p.installAgentId ?? t.installAgentId,
      title: p.title || t.title
    }
  })
}
