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
