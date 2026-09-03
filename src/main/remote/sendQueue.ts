export const REMOTE_SEND_QUEUE_MAX = 20

export type RemoteQueuedSend = { text: string; attachments: string[] }

/** Cap follow-up phone turns per conversation so a cancelled turn cannot flood. */
export class RemoteSendQueue {
  private readonly pending = new Map<string, RemoteQueuedSend[]>()
  private readonly max: number

  constructor(max = REMOTE_SEND_QUEUE_MAX) {
    this.max = max
  }

  clear(conversationId: string): void {
    this.pending.delete(conversationId)
  }

  enqueue(conversationId: string, text: string, attachments: string[]): void {
    const queue = this.pending.get(conversationId) ?? []
    if (queue.length >= this.max) return
    queue.push({ text, attachments })
    this.pending.set(conversationId, queue)
  }

  takeReady(
    isBusy: (conversationId: string) => boolean
  ): { conversationId: string; text: string; attachments: string[] }[] {
    const out: { conversationId: string; text: string; attachments: string[] }[] = []
    for (const [conversationId, queue] of this.pending) {
      if (!queue.length || isBusy(conversationId)) continue
      const next = queue.shift()
      if (!queue.length) this.pending.delete(conversationId)
      if (next) out.push({ conversationId, text: next.text, attachments: next.attachments })
    }
    return out
  }
}
