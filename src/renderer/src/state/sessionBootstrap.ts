import { conversationOnMachine } from '../../../shared/workspaceHost.ts'
import type { AgentConfig, AppSettings } from '../../../shared/types.ts'

type BootstrapConversation = {
  id: string
  archived?: boolean
  fileId?: string | null
  updatedAt: number
  machineId?: string | null
}

/** Pick the sidebar session for a full main-window bootstrap. */
export function pickBootstrapActiveId(
  conversations: BootstrapConversation[],
  preferredId: string,
  windowMachineId: string
): string {
  const listed = conversations.find((conversation) => conversation.id === preferredId)
  if (
    listed &&
    !listed.archived &&
    !listed.fileId &&
    conversationOnMachine(listed, windowMachineId)
  ) {
    return preferredId
  }
  return (
    conversations
      .filter(
        (conversation) =>
          !conversation.archived &&
          !conversation.fileId &&
          conversationOnMachine(conversation, windowMachineId)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? ''
  )
}

export type MachineConversationAction =
  | { action: 'keep' }
  | { action: 'select'; id: string }
  | { action: 'create' }

/** After the sidebar switches machines, keep / pick / mint a session on that host. */
export function nextConversationForMachine(
  conversations: BootstrapConversation[],
  activeId: string,
  windowMachineId: string
): MachineConversationAction {
  const current = conversations.find((conversation) => conversation.id === activeId)
  if (
    current &&
    !current.archived &&
    !current.fileId &&
    conversationOnMachine(current, windowMachineId)
  ) {
    return { action: 'keep' }
  }
  const next = conversations
    .filter(
      (conversation) =>
        !conversation.archived &&
        !conversation.fileId &&
        conversationOnMachine(conversation, windowMachineId)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (next) return { action: 'select', id: next.id }
  return { action: 'create' }
}

/**
 * Legacy settings.json often had `cliAgents: []`. Fill the catalogue in place
 * and report whether the caller should persist `cliAgents`.
 */
export function seedCliAgentCatalogue(
  settings: AppSettings,
  defaults: AgentConfig[]
): { persistCliAgents: boolean } {
  if (!Array.isArray(settings.removedCliAgentIds)) settings.removedCliAgentIds = []
  let persistCliAgents = false
  if (!Array.isArray(settings.cliAgents) || settings.cliAgents.length === 0) {
    const removed = new Set(settings.removedCliAgentIds)
    const seed = defaults.filter((agent) => !removed.has(agent.id))
    settings.cliAgents = (seed.length > 0 ? seed : defaults).map((agent) => ({
      ...agent,
      envVars: { ...agent.envVars },
      defaultArgs: [...agent.defaultArgs],
      binaryCandidates: agent.binaryCandidates ? [...agent.binaryCandidates] : undefined
    }))
    persistCliAgents = true
  }
  if (!settings.disabledAgentModels || typeof settings.disabledAgentModels !== 'object') {
    settings.disabledAgentModels = {}
  }
  if (!settings.defaultAgentModels || typeof settings.defaultAgentModels !== 'object') {
    settings.defaultAgentModels = {}
  }
  return { persistCliAgents }
}

type InheritCreateConversation = {
  workingDirectory?: string | null
  machineId?: string | null
}

/**
 * First send / ⌘N inherit the active session folder when it is a real project
 * on this machine — never a temp shell or another daemon's path.
 */
export function inheritCreateWorkingDirectory(opts: {
  active?: InheritCreateConversation | null
  activeMachine: string
  isTemporary: (path: string) => boolean
}): string | undefined {
  const wd = opts.active?.workingDirectory
  if (
    wd &&
    !wd.startsWith('__') &&
    !opts.isTemporary(wd) &&
    opts.active &&
    conversationOnMachine(opts.active, opts.activeMachine)
  ) {
    return wd
  }
  return undefined
}
