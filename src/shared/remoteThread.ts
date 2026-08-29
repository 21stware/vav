/**
 * Phone-sized projection of a conversation path: last N plain-text turns
 * and a one-line list preview. Host RPCs stay off this channel.
 */
import type { AppLocale } from './i18n/index.ts'
import { markdownToPlainText } from './markdownPlain.ts'
import type { ChatMessage, MessageBlock, PlanBlock, ToolCallBlock } from './types.ts'
import type { RemoteThreadBlock, RemoteThreadMessage } from './remoteControl.ts'
import { toolDisplayName } from './toolDisplayName.ts'

export const REMOTE_THREAD_MAX_MESSAGES = 40
export const REMOTE_THREAD_TEXT_CAP = 8000
export const REMOTE_PREVIEW_CAP = 80

function oneLine(source: string): string {
  return markdownToPlainText(source).replace(/\s+/g, ' ').trim()
}

function projectBlocks(
  blocks: MessageBlock[] | undefined,
  locale: AppLocale
): RemoteThreadBlock[] | undefined {
  if (!blocks?.length) return undefined
  const out: RemoteThreadBlock[] = []
  for (const block of blocks) {
    if (block.kind === 'text') {
      const text = block.text.replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
      if (text) out.push({ kind: 'text', text })
    } else if (block.kind === 'reasoning') {
      const text = block.text.trim()
      if (text) out.push({ kind: 'reasoning', text: text.slice(0, REMOTE_THREAD_TEXT_CAP) })
    } else if (block.kind === 'plan') {
      out.push(projectRemotePlan(block))
    } else if (block.kind === 'toolCall') {
      out.push(projectRemoteToolBlock(block, locale))
    }
  }
  return out.length ? out : undefined
}

export function projectRemotePlan(block: PlanBlock): RemoteThreadBlock {
  return {
    kind: 'plan',
    title: block.title || 'Plan',
    steps: (block.steps ?? []).slice(0, 40).map((step) => ({
      text: (step.title || '').slice(0, 200),
      done: step.status === 'done'
    }))
  }
}

export function projectRemoteToolBlock(
  block: ToolCallBlock,
  locale: AppLocale = 'zh-CN'
): RemoteThreadBlock {
  const pending = block.status === 'pending'
  const interactive =
    pending &&
    (block.tool === 'ask_user_question' ||
      block.tool === 'plan_doc' ||
      block.tool === 'request' ||
      Boolean(block.choices?.length || block.questions?.length))
  if (interactive) {
    const question = block.questions?.[0]
    const choices = (block.choices ?? question?.choices ?? []).slice(0, 12).map((label) => ({
      id: label,
      label
    }))
    return {
      kind: 'awaiting',
      id: block.id,
      tool: block.tool,
      name: toolDisplayName(block.tool, locale),
      title: (block.askTitle || block.summary || block.tool).slice(0, 120),
      prompt: (question?.question || block.summary || '').slice(0, 2000),
      choices,
      ...(question?.multiSelect || block.multiSelect ? { multiSelect: true } : {})
    }
  }
  return {
    kind: 'tool',
    id: block.id,
    tool: block.tool,
    name: toolDisplayName(block.tool, locale),
    summary: (block.summary || block.tool).slice(0, 200),
    status: block.status
  }
}

export function projectRemoteMessages(
  path: ChatMessage[],
  locale: AppLocale = 'zh-CN'
): RemoteThreadMessage[] {
  const rows: RemoteThreadMessage[] = []
  for (const message of path) {
    if (message.role === 'system') continue
    // Keep newlines / markdown so the phone can render the same log as desktop.
    let text = (message.content || '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
    const blocks = projectBlocks(message.blocks, locale)
    if (!text) {
      if (message.role !== 'assistant' && !blocks?.length) continue
      if (!text) text = blocks?.length ? '' : '（工具回合）'
    }
    if (text.length > REMOTE_THREAD_TEXT_CAP) text = `${text.slice(0, REMOTE_THREAD_TEXT_CAP)}…`
    rows.push({
      id: message.id,
      role: message.role,
      text,
      at: message.createdAt,
      ...(blocks ? { blocks } : {}),
      ...(message.cancelled ? { cancelled: true } : {}),
      ...(message.errorText ? { error: message.errorText.slice(0, 500) } : {})
    })
  }
  return rows.slice(-REMOTE_THREAD_MAX_MESSAGES)
}

export function remoteSessionPreview(path: ChatMessage[]): string {
  const last = projectRemoteMessages(path).at(-1)
  if (!last) return ''
  const flat = oneLine(last.text)
  if (!flat) return ''
  return flat.length > REMOTE_PREVIEW_CAP ? `${flat.slice(0, REMOTE_PREVIEW_CAP)}…` : flat
}
