import { test, expect } from '@playwright/test'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import { REMOTE_PHONE_CLIENT_TYPES } from '../../src/shared/remoteControl.ts'
import { connectPhone } from '../../src/main/cli/vavPhoneClient.ts'
import {
  applyGoal,
  archiveSession,
  browseWorkspace,
  cancelSession,
  compactSession,
  configureSession,
  continueSession,
  createSession,
  deleteMessage,
  duplicateSession,
  editSession,
  favoriteSession,
  fetchControls,
  fetchThread,
  forkSession,
  locateWorkspace,
  pinSession,
  regenerateSession,
  reviewSession,
  renameSession,
  replySession,
  sendTurn,
  setLeaf,
  setWorkspace
} from '../../src/main/cli/vavControl.ts'
import { DaemonClient } from '../../src/main/daemon/DaemonClient.ts'
import { startVavd } from '../startVavd'

/**
 * iOS / Android hello omits `role`. This is that handshake against a live
 * vavd, then every phone-plane verb those remotes send.
 */
test('phone hello without role covers every iOS/Android session verb', async () => {
  const daemon = await startVavd({ stubTurn: true })
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    expect(parsed?.secret).toBeTruthy()
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: parsed!.port,
      secret: parsed!.secret,
      device: 'VAV Remote',
      omitRole: true
    })
    try {
      expect(phone.frames.some((msg) => msg.type === 'welcome')).toBe(true)
      await phone.wait((msg) => msg.type === 'host')
      expect(phone.frames.some((msg) => msg.type === 'host')).toBe(true)

      const session = await createSession(phone)
      await setWorkspace(phone, session.id, daemon.workspace)
      const dirs = await browseWorkspace(phone, session.id, daemon.workspace, true)
      expect(dirs.entries.some((entry) => entry.name === 'remote-only.md')).toBe(true)

      const controls = await configureSession(phone, session.id, { approval: 'edit' })
      expect(controls && controls.type === 'controls').toBe(true)
      if (controls && controls.type === 'controls') expect(controls.approval).toBe('edit')
      await fetchControls(phone, session.id)

      await renameSession(phone, session.id, 'phone-remote')
      await pinSession(phone, session.id, true)
      await favoriteSession(phone, session.id, true)

      const turn = await sendTurn(phone, session.id, 'hello from iOS/Android remote')
      expect(turn.phase === 'done' || turn.phase === 'error').toBeTruthy()

      const thread = await fetchThread(phone, session.id)
      expect(thread && thread.type === 'thread').toBe(true)
      const messages = thread && thread.type === 'thread' ? thread.messages : []
      const assistant = [...messages].reverse().find((row) => row.role === 'assistant')
      const user = [...messages].reverse().find((row) => row.role === 'user')
      expect(assistant?.id).toBeTruthy()
      expect(user?.id).toBeTruthy()

      const regenerated = await regenerateSession(phone, session.id, assistant!.id)
      expect(regenerated.phase === 'done' || regenerated.phase === 'error').toBeTruthy()
      const edited = await editSession(phone, session.id, user!.id, 'edited from remote')
      expect(edited.phase === 'done' || edited.phase === 'error').toBeTruthy()
      await forkSession(phone, session.id, assistant!.id)
      await setLeaf(phone, session.id, assistant!.id)

      const goaled = await applyGoal(phone, session.id, 'set', 'ship the phone remote')
      expect(goaled.type).toBe('goaled')

      const compacted = await compactSession(phone, session.id)
      expect(compacted.type).toBe('compacted')

      const duplicated = await duplicateSession(phone, session.id)
      expect(duplicated.id).toBeTruthy()
      expect(duplicated.id).not.toBe(session.id)

      const continued = await continueSession(phone, session.id, assistant!.id)
      expect(continued.id).toBeTruthy()
      expect(continued.id).not.toBe(session.id)

      const temp = await createSession(phone)
      await setWorkspace(phone, temp.id, undefined, true)
      const located = await locateWorkspace(phone, temp.id, daemon.workspace)
      expect(typeof located.ok).toBe('boolean')

      const rpc = new DaemonClient()
      await rpc.connect({
        host: '127.0.0.1',
        port: parsed!.port,
        secret: parsed!.secret,
        device: 'phone-review-seed'
      })
      try {
        const seeded = (await rpc.request('changeSets.seedReview', {
          conversationId: session.id
        })) as { set?: { id?: string; files?: unknown[] } }
        expect(seeded.set?.id).toBeTruthy()
        const reviewed = await reviewSession(phone, session.id, 'get', seeded.set!.id)
        expect(reviewed.ok).toBe(true)
        expect(reviewed.set?.files?.length).toBe(2)
        const accepted = await reviewSession(phone, session.id, 'accept-all', seeded.set!.id)
        expect(accepted.ok).toBe(true)
        expect(accepted.set?.status).toBe('accepted')
      } finally {
        rpc.close()
      }

      await deleteMessage(phone, session.id, assistant!.id)
      phone.send({ type: 'cancel', conversationId: session.id })
      await phone
        .waitNew(
          (msg) =>
            (msg.type === 'turn' && msg.conversationId === session.id) ||
            (msg.type === 'error' && msg.conversationId === session.id),
          4_000
        )
        .catch(() => undefined)
      await archiveSession(phone, session.id)
      expect(REMOTE_PHONE_CLIENT_TYPES).toContain('cancel')
      expect(REMOTE_PHONE_CLIENT_TYPES).toContain('reply')
    } finally {
      phone.close()
    }
  } finally {
    daemon.stop()
  }
})

function isAwaitingTurn(msg: { type?: string; phase?: string; awaiting?: { id?: string } }): boolean {
  return msg.type === 'turn' && (msg.phase === 'awaiting' || Boolean(msg.awaiting?.id))
}

async function waitForAwaiting(phone: { frames: Array<{ type?: string; phase?: string; awaiting?: { id?: string } }> }) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const row = phone.frames.findLast((msg) => isAwaitingTurn(msg))
    if (row && row.type === 'turn' && row.awaiting?.id) return row
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(
    `no awaiting turn; saw ${phone.frames.map((msg) => `${msg.type}:${'phase' in msg ? msg.phase : ''}`).join(',')}`
  )
}

test('phone hello without role parks Approve and accepts reply / cancel', async () => {
  const daemon = await startVavd({ stubTurn: true, stubApprove: true })
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: parsed!.port,
      secret: parsed!.secret,
      device: 'iPhone',
      omitRole: true
    })
    try {
      await phone.wait((msg) => msg.type === 'host')
      const parked = await createSession(phone)
      phone.send({ type: 'send', conversationId: parked.id, text: 'cancel this' })
      await waitForAwaiting(phone)
      await cancelSession(phone, parked.id)

      const session = await createSession(phone)
      phone.send({ type: 'send', conversationId: session.id, text: 'approve this' })
      const row = await waitForAwaiting(phone)
      const toolCallId = row.awaiting!.id
      await replySession(phone, session.id, toolCallId, 'Approve')
      const done = await phone.wait(
        (msg) =>
          msg.type === 'turn' &&
          msg.conversationId === session.id &&
          (msg.phase === 'done' || msg.phase === 'error'),
        15_000
      )
      expect(done.some((msg) => msg.type === 'turn' && msg.phase === 'done')).toBe(true)
    } finally {
      phone.close()
    }
  } finally {
    daemon.stop()
  }
})
