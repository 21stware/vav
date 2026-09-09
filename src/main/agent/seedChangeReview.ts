/**
 * Deterministic 2-file change-review used by e2e / smoke.
 * Headless vav-server and the Electron shell share this so Accept lives on one store.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage } from '../../shared/types.ts'
import type { ChangeSetStore } from './ChangeSetStore.ts'

export async function seedChangeReviewTurn(opts: {
  conversationId: string
  workdir: string
  model?: string
  changeSets: ChangeSetStore
  appendMessages: (user: ChatMessage, assistant: ChatMessage) => void
}): Promise<{ setId: string; pendingCount: number } | null> {
  const dir = join(opts.workdir, '.vav-smoke')
  mkdirSync(dir, { recursive: true })
  const modified = join(dir, 'existing.ts')
  const added = join(dir, 'added.ts')
  writeFileSync(modified, 'const a = 1\n', 'utf8')
  opts.changeSets.beginTurn(opts.conversationId, opts.workdir)
  opts.changeSets.recordWrite(opts.conversationId, opts.workdir, modified, 'const a = 1\n', 'const a = 2\n')
  opts.changeSets.recordWrite(opts.conversationId, opts.workdir, added, null, 'export const x = 1\n')
  writeFileSync(modified, 'const a = 2\n', 'utf8')
  writeFileSync(added, 'export const x = 1\n', 'utf8')
  const set = await opts.changeSets.finalizeTurn(
    opts.conversationId,
    'smoke change review',
    opts.model || 'test'
  )
  if (!set) return null
  const userMsg: ChatMessage = {
    id: randomUUID(),
    parentId: null,
    role: 'user',
    content: 'Please update the smoke files.',
    blocks: [{ kind: 'text', text: 'Please update the smoke files.' }],
    createdAt: Date.now()
  }
  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    parentId: userMsg.id,
    role: 'assistant',
    content: 'Updated two files.',
    blocks: [{ kind: 'text', text: 'Updated two files.' }],
    createdAt: Date.now() + 1,
    changeSetId: set.id
  }
  opts.appendMessages(userMsg, assistantMsg)
  return { setId: set.id, pendingCount: set.files.length }
}
