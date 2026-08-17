import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import {
  cursorAuthIdentity,
  withCursorAuthIdentity,
  type ProviderResumeCursor
} from '@shared/cliHost'
import {
  applySwarmSessionArgs,
  bindingSessionIds,
  canMintSwarmSessionId,
  clipProjectedTitle,
  mintSwarmCursor,
  nativeSessionId,
  newestBinding,
  type CliPaneBinding
} from '@shared/cliPaneBinding'
import { isBlankSwarmSessionTitle, swarmSessionKey } from '@shared/cliSessionHistory'
import { isDefaultSessionTitle } from '@shared/i18n'
import type { CliHostKind } from '@shared/types'
import { isStructuredCliHost } from '@shared/types'
import { readHostAuthIdentity } from './hostAuth'
import {
  discoverHostSession,
  hostSessionExists,
  hostSessionHasConversation,
  readHostSessionTitle
} from './hostSessionStore'
import type { ConversationStore } from '../store/ConversationStore'
import type { SwarmHistoryStore } from '../store/SwarmHistoryStore'

const TITLE_POLL_MS = 4_000
const DISCOVER_ATTEMPTS = [400, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
const DISCOVER_SLACK_MS = 4_000

export interface SwarmLaunchPlan {
  args: string[]
  tabId: string
}

export function createSwarmSessionService(deps: {
  conversations: ConversationStore
  history?: SwarmHistoryStore
  publish: () => void
  listLivePanes?: () => { conversationId: string; tabId: string; agentId: string }[]
}): {
  prepareLaunch(
    conversationId: string,
    tabId: string,
    agentId: string,
    defaultArgs: string[],
    resume?: { cursor: ProviderResumeCursor; title?: string | null }
  ): Promise<SwarmLaunchPlan>
  afterSpawn(conversationId: string, tabId: string, agentId: string): void
  adoptPane(conversationId: string, tabId: string, agentId: string): void
  adoptRecordedBindings(): void
  forgetPane(conversationId: string, tabId: string): void
  clearForConversation(conversationId: string): void
  syncHostCursor(conversationId: string, host: CliHostKind | null): void
  refreshTitles(): void
  dispose(): void
} {
  const discoverTimers = new Map<string, NodeJS.Timeout>()
  const lastAdoptAt = new Map<string, number>()
  const titleTimer = setInterval(() => refreshTitles(), TITLE_POLL_MS)
  titleTimer.unref?.()

  function paneKey(conversationId: string, tabId: string): string {
    return `${conversationId}::${tabId}`
  }

  function stopDiscover(conversationId: string, tabId: string): void {
    const key = paneKey(conversationId, tabId)
    const timer = discoverTimers.get(key)
    if (timer) clearTimeout(timer)
    discoverTimers.delete(key)
  }

  function bindingsOf(conversationId: string): Record<string, CliPaneBinding> {
    return { ...(deps.conversations.getCliPaneBindings(conversationId) ?? {}) }
  }

  function remember(conversationId: string, binding: CliPaneBinding): void {
    const conversation = deps.conversations.get(conversationId)
    const sessionId = nativeSessionId(binding.cursor)
    if (!conversation || !sessionId) return
    const cwd = conversation.workingDirectory || homedir()
    const title = isBlankSwarmSessionTitle(binding.title) ? null : (binding.title ?? null)
    if (
      isBlankSwarmSessionTitle(title) &&
      !hostSessionHasConversation(binding.agentId, sessionId, cwd)
    ) {
      deps.history?.remove(swarmSessionKey(binding.agentId, sessionId))
      return
    }
    deps.history?.upsert({
      agentId: binding.agentId,
      cursor: binding.cursor,
      conversationId,
      workingDirectory: cwd,
      title
    })
  }

  function upsert(conversationId: string, binding: CliPaneBinding): void {
    deps.conversations.upsertCliPaneBinding(conversationId, binding)
    remember(conversationId, binding)
    const conversation = deps.conversations.get(conversationId)
    if (!conversation) return
    if (
      conversation.cliHost === binding.agentId ||
      conversation.agentBinaryName === binding.agentId
    ) {
      deps.conversations.updateMeta(conversationId, { cliResumeCursor: binding.cursor })
    }
  }

  async function prepareLaunch(
    conversationId: string,
    tabId: string,
    agentId: string,
    defaultArgs: string[],
    resume?: { cursor: ProviderResumeCursor; title?: string | null }
  ): Promise<SwarmLaunchPlan> {
    if (!isStructuredCliHost(agentId)) {
      return { args: defaultArgs, tabId }
    }
    const conversation = deps.conversations.get(conversationId)
    if (!conversation) return { args: defaultArgs, tabId }

    // History (or an explicit restore) is the only path that may attach an
    // existing native session. A picker / new pane always starts blank —
    // leftover tab bindings must not `--resume` the previous chat.
    let binding: CliPaneBinding | null = null
    if (resume?.cursor) {
      binding = {
        tabId,
        agentId,
        cursor: resume.cursor,
        title: resume.title ?? bindingsOf(conversationId)[tabId]?.title ?? null,
        projectedTitle: bindingsOf(conversationId)[tabId]?.projectedTitle ?? null,
        updatedAt: Date.now()
      }
      upsert(conversationId, binding)
    } else if (bindingsOf(conversationId)[tabId]) {
      deps.conversations.deleteCliPaneBinding(conversationId, tabId)
    }

    const identity = await readHostAuthIdentity(agentId)
    if (binding) {
      const stored = cursorAuthIdentity(binding.cursor)
      if (stored && identity && stored !== identity) {
        deps.conversations.deleteCliPaneBinding(conversationId, tabId)
        binding = null
      }
    }

    let cursor: ProviderResumeCursor | null = binding?.cursor ?? null
    let minted: string | null = null
    const cwd = conversation.workingDirectory || homedir()
    if (resume?.cursor && cursor && canMintSwarmSessionId(agentId)) {
      const id = nativeSessionId(cursor)
      if (id && !hostSessionExists(agentId, id, cwd)) minted = id
    } else if (!cursor && canMintSwarmSessionId(agentId)) {
      minted = randomUUID()
      cursor = mintSwarmCursor(agentId, minted)
    }
    if (cursor) {
      cursor = withCursorAuthIdentity(cursor, identity)
      upsert(conversationId, {
        tabId,
        agentId,
        cursor,
        title: binding?.title ?? null,
        projectedTitle: binding?.projectedTitle ?? null,
        updatedAt: Date.now()
      })
    }

    return {
      tabId,
      args: applySwarmSessionArgs(agentId, defaultArgs, cursor, minted)
    }
  }

  function afterSpawn(conversationId: string, tabId: string, agentId: string): void {
    if (!isStructuredCliHost(agentId)) return
    const binding = bindingsOf(conversationId)[tabId]
    if (binding && nativeSessionId(binding.cursor)) {
      applyTitleFromBinding(conversationId, tabId)
      return
    }
    scheduleDiscover(conversationId, tabId, agentId, Date.now(), 0)
  }

  function adoptPane(conversationId: string, tabId: string, agentId: string): void {
    if (!isStructuredCliHost(agentId)) return
    const existing = bindingsOf(conversationId)[tabId]
    if (existing && nativeSessionId(existing.cursor)) return
    const key = paneKey(conversationId, tabId)
    const now = Date.now()
    if ((lastAdoptAt.get(key) ?? 0) + 2_000 > now) return
    lastAdoptAt.set(key, now)
    const conversation = deps.conversations.get(conversationId)
    tryDiscover(conversationId, tabId, agentId, conversation?.createdAt ?? now)
  }

  function scheduleDiscover(
    conversationId: string,
    tabId: string,
    agentId: CliHostKind,
    spawnedAt: number,
    attempt: number
  ): void {
    stopDiscover(conversationId, tabId)
    const wait = DISCOVER_ATTEMPTS[attempt]
    if (wait == null) return
    const key = paneKey(conversationId, tabId)
    const timer = setTimeout(() => {
      discoverTimers.delete(key)
      if (tryDiscover(conversationId, tabId, agentId, spawnedAt)) return
      scheduleDiscover(conversationId, tabId, agentId, spawnedAt, attempt + 1)
    }, wait)
    timer.unref?.()
    discoverTimers.set(key, timer)
  }

  function tryDiscover(
    conversationId: string,
    tabId: string,
    agentId: CliHostKind,
    spawnedAt: number
  ): boolean {
    const conversation = deps.conversations.get(conversationId)
    if (!conversation) return true
    const existing = bindingsOf(conversationId)[tabId]
    if (existing && nativeSessionId(existing.cursor)) {
      applyTitleFromBinding(conversationId, tabId)
      return true
    }
    const cwd = conversation.workingDirectory || homedir()
    const found = discoverHostSession(agentId, cwd, {
      afterMs: spawnedAt - DISCOVER_SLACK_MS,
      excludeIds: bindingSessionIds(bindingsOf(conversationId), tabId)
    })
    if (!found) return false
    const cursor = mintSwarmCursor(agentId, found.id)
    if (!cursor) return false
    upsert(conversationId, {
      tabId,
      agentId,
      cursor,
      title: found.title,
      projectedTitle: existing?.projectedTitle ?? null,
      updatedAt: Date.now()
    })
    applyTitleFromBinding(conversationId, tabId)
    return true
  }

  function applyTitleFromBinding(conversationId: string, tabId: string): void {
    const conversation = deps.conversations.get(conversationId)
    if (!conversation) return
    const binding = bindingsOf(conversationId)[tabId]
    if (!binding) return
    const cwd = conversation.workingDirectory || homedir()
    const id = nativeSessionId(binding.cursor)
    const title = id ? readHostSessionTitle(binding.agentId, id, cwd) : binding.title
    if (title && title !== binding.title) {
      upsert(conversationId, { ...binding, title, updatedAt: Date.now() })
    }
    projectConversationTitle(conversationId)
  }

  function projectConversationTitle(conversationId: string): void {
    const conversation = deps.conversations.get(conversationId)
    if (!conversation) return
    const all = bindingsOf(conversationId)
    const latest = newestBinding(all)
    const raw = latest?.title?.trim()
    if (!raw) return
    const next = clipProjectedTitle(raw)
    if (!next) return
    const projected = new Set(
      Object.values(all)
        .map((row) => row.projectedTitle)
        .filter((value): value is string => !!value)
    )
    if (!isDefaultSessionTitle(conversation.title) && !projected.has(conversation.title)) {
      return
    }
    if (conversation.title === next) {
      if (latest && latest.projectedTitle !== next) {
        upsert(conversationId, { ...latest, projectedTitle: next, updatedAt: latest.updatedAt })
      }
      return
    }
    deps.conversations.updateMeta(conversationId, { title: next })
    if (latest) {
      upsert(conversationId, { ...latest, projectedTitle: next, updatedAt: latest.updatedAt })
    }
    deps.publish()
  }

  function refreshTitles(): void {
    for (const pane of deps.listLivePanes?.() ?? []) {
      adoptPane(pane.conversationId, pane.tabId, pane.agentId)
    }
    for (const conversation of deps.conversations.all()) {
      const all = conversation.cliPaneBindings
      if (!all || Object.keys(all).length === 0) continue
      const projected = new Set(
        Object.values(all)
          .map((row) => row.projectedTitle)
          .filter((value): value is string => !!value)
      )
      if (
        !isDefaultSessionTitle(conversation.title) &&
        !projected.has(conversation.title)
      ) {
        continue
      }
      const cwd = conversation.workingDirectory || homedir()
      let changed = false
      for (const binding of Object.values(all)) {
        const id = nativeSessionId(binding.cursor)
        if (!id) continue
        const title = readHostSessionTitle(binding.agentId, id, cwd)
        if (title && title !== binding.title) {
          const next = { ...binding, title, updatedAt: Date.now() }
          deps.conversations.upsertCliPaneBinding(conversation.id, next)
          remember(conversation.id, next)
          changed = true
        }
      }
      if (changed || isDefaultSessionTitle(conversation.title)) {
        projectConversationTitle(conversation.id)
      }
    }
  }

  function forgetPane(conversationId: string, tabId: string): void {
    stopDiscover(conversationId, tabId)
    lastAdoptAt.delete(paneKey(conversationId, tabId))
    const binding = bindingsOf(conversationId)[tabId]
    if (binding) remember(conversationId, binding)
    deps.conversations.deleteCliPaneBinding(conversationId, tabId)
  }

  function adoptRecordedBindings(): void {
    for (const conversation of deps.conversations.all()) {
      for (const binding of Object.values(conversation.cliPaneBindings ?? {})) {
        remember(conversation.id, binding)
      }
    }
  }

  function clearForConversation(conversationId: string): void {
    for (const key of [...discoverTimers.keys()]) {
      if (key.startsWith(`${conversationId}::`)) {
        const timer = discoverTimers.get(key)
        if (timer) clearTimeout(timer)
        discoverTimers.delete(key)
      }
    }
    for (const key of [...lastAdoptAt.keys()]) {
      if (key.startsWith(`${conversationId}::`)) lastAdoptAt.delete(key)
    }
    deps.conversations.clearCliPaneBindings(conversationId)
  }

  return {
    prepareLaunch,
    afterSpawn,
    adoptPane,
    adoptRecordedBindings,
    forgetPane,
    clearForConversation,
    syncHostCursor(conversationId, host) {
      if (!host) return
      const latest = newestBinding(bindingsOf(conversationId), host)
      if (latest) {
        deps.conversations.updateMeta(conversationId, { cliResumeCursor: latest.cursor })
      }
    },
    refreshTitles,
    dispose() {
      clearInterval(titleTimer)
      for (const timer of discoverTimers.values()) clearTimeout(timer)
      discoverTimers.clear()
    }
  }
}
