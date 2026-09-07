import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test, expect } from '@playwright/test'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import { startVavd } from '../startVavd'

const execFileAsync = promisify(execFile)
const root = join(__dirname, '../..')
const aliasHook = pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href

function vavc(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ['--import', aliasHook, '--experimental-strip-types', join(root, 'packages/vavc/src/vavc.ts'), ...args],
    { cwd: root, timeout: 20_000 }
  )
}

/**
 * Live coverage of every product-matrix feature branch against one vavd.
 * Desktop / Chrome / iOS / Android are shells over these same verbs.
 */
test('vavd covers list, send, workspace, files, remote, terminal, and settings branches', async () => {
  const daemon = await startVavd({ stubTurn: true })
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    expect(parsed?.secret).toBeTruthy()
    const auth = ['--host', '127.0.0.1', '--port', String(parsed!.port), '--secret', parsed!.secret]

    // 远程连接
    const status = JSON.parse((await vavc(['status', ...auth])).stdout) as { ok?: boolean }
    expect(status.ok).toBe(true)
    const pairing = JSON.parse((await vavc(['host', 'pairing', ...auth])).stdout) as { pairing?: string }
    expect(pairing.pairing).toMatch(/^vavrtp:\/\//)
    const incoming = JSON.parse((await vavc(['host', 'incoming', ...auth])).stdout) as {
      controllers?: Array<{ id?: string }>
    }
    expect(Array.isArray(incoming.controllers)).toBe(true)
    expect(incoming.controllers?.length).toBeGreaterThan(0)

    // 列表与资源管理
    const created = JSON.parse(
      (await vavc(['session', 'create', '--cwd', daemon.workspace, '--label', 'matrix', ...auth])).stdout
    ) as { id?: string }
    expect(created.id).toBeTruthy()
    const listed = JSON.parse((await vavc(['session', 'list', ...auth])).stdout) as Array<{ id?: string }>
    expect(listed.some((row) => row.id === created.id)).toBe(true)
    await vavc(['session', 'pin', created.id!, ...auth])
    await vavc(['session', 'star', created.id!, ...auth])

    // 工作区功能
    const browsed = JSON.parse(
      (await vavc(['workspace', 'browse', created.id!, daemon.workspace, '--files', ...auth])).stdout
    ) as { type?: string; entries?: Array<{ name?: string }> }
    expect(browsed.type).toBe('dirs')
    expect(browsed.entries?.some((entry) => entry.name === 'remote-only.md')).toBe(true)

    // 文件查看与选择对话
    const files = JSON.parse(
      (await vavc(['file', 'list', daemon.workspace, ...auth])).stdout
    ) as { entries?: Array<{ name?: string }> }
    expect(files.entries?.some((entry) => entry.name === 'remote-only.md')).toBe(true)
    const writtenPath = join(daemon.workspace, 'matrix-out.md')
    await vavc(['file', 'write', writtenPath, '--text', 'from-vavc', ...auth])
    const readBack = JSON.parse((await vavc(['file', 'read', writtenPath, ...auth])).stdout) as {
      text?: string
    }
    expect(readBack.text).toBe('from-vavc')
    const fileSession = JSON.parse(
      (await vavc(['file-session', 'open', join(daemon.workspace, 'remote-only.md'), ...auth])).stdout
    ) as { fileId?: string }
    expect(fileSession.fileId).toBeTruthy()

    const plugins = JSON.parse((await vavc(['plugins', 'list', ...auth])).stdout) as {
      host?: string
      plugins?: unknown[]
    }
    expect(plugins.host).toBe('vav')
    expect(Array.isArray(plugins.plugins)).toBe(true)
    const git = JSON.parse((await vavc(['git', 'status', daemon.workspace, ...auth])).stdout) as {
      isRepo?: boolean
    }
    expect(typeof git.isRepo).toBe('boolean')
    const bare = join(daemon.workspace, 'matrix-init')
    mkdirSync(bare, { recursive: true })
    // git init — same host verb as desktop / Chrome Git tab
    const inited = JSON.parse((await vavc(['git', 'init', bare, ...auth])).stdout) as {
      ok?: boolean
      data?: { isRepo?: boolean }
    }
    expect(inited.ok).toBe(true)
    expect(inited.data?.isRepo).toBe(true)
    const connectors = JSON.parse((await vavc(['connectors', ...auth])).stdout) as Array<{ id?: string }>
    expect(connectors.some((row) => row.id === 'github')).toBe(true)

    // 配置
    await vavc(['configure', '--session', created.id!, '--approval', 'edit', ...auth])
    const accounts = JSON.parse((await vavc(['account', 'list', ...auth])).stdout) as {
      accounts?: Array<{ id?: string }>
    }
    expect(Array.isArray(accounts.accounts)).toBe(true)
    const drafted = JSON.parse((await vavc(['account', 'draft', '--agent', 'vav', ...auth])).stdout) as {
      id?: string
      page?: { accounts?: Array<{ id?: string }> }
    }
    expect(drafted.id).toBeTruthy()
    expect(drafted.page?.accounts?.some((row) => row.id === drafted.id)).toBe(true)
    const afterDraft = JSON.parse((await vavc(['account', 'list', ...auth])).stdout) as {
      accounts?: Array<{ id?: string }>
    }
    expect(afterDraft.accounts?.some((row) => row.id === drafted.id)).toBe(true)
    await vavc(['account', 'remove', drafted.id!, ...auth])
    const afterRemove = JSON.parse((await vavc(['account', 'list', ...auth])).stdout) as {
      accounts?: Array<{ id?: string }>
    }
    expect(afterRemove.accounts?.some((row) => row.id === drafted.id)).toBe(false)
    const cancelled = JSON.parse(
      (await vavc(['account', 'cancel', '--agent', 'grok', ...auth])).stdout
    ) as { accounts?: unknown[] }
    expect(Array.isArray(cancelled.accounts)).toBe(true)
    await expect(vavc(['account', 'oauth', '--agent', 'not-a-host', ...auth])).rejects.toMatchObject({
      stderr: expect.stringMatching(/找不到这个账户|That account is gone|missing/i)
    })
    const hostSettings = JSON.parse((await vavc(['settings', ...auth])).stdout) as {
      defaultModel?: string
    }
    expect(hostSettings.defaultModel).toBeTruthy()
    const updatedSettings = JSON.parse(
      (await vavc(['settings', 'set', '--approval', 'edit', ...auth])).stdout
    ) as { defaultApprovalMode?: string }
    expect(updatedSettings.defaultApprovalMode).toBe('edit')

    // terminal 服务
    const pane = JSON.parse(
      (await vavc(['pane', 'run', '--cwd', daemon.workspace, 'echo', 'vav-matrix', ...auth])).stdout
    ) as { output?: string; stream?: string }
    expect(pane.stream).toBeTruthy()
    expect(pane.output).toMatch(/vav-matrix/)

    // agent 输入与对话
    const turn = JSON.parse(
      (await vavc(['agent', 'prompt', created.id!, 'hello matrix', '--wait', ...auth])).stdout
    ) as { session?: string }
    expect(turn.session).toBe(created.id)
    const thread = JSON.parse((await vavc(['session', 'attach', created.id!, ...auth])).stdout) as {
      messages?: Array<{ id?: string; role?: string }>
    }
    const assistant = [...(thread.messages ?? [])].reverse().find((row) => row.role === 'assistant')
    expect(assistant?.id).toBeTruthy()
    const regenerated = JSON.parse(
      (await vavc(['session', 'regenerate', created.id!, assistant!.id!, ...auth])).stdout
    ) as { type?: string; conversationId?: string; phase?: string }
    expect(regenerated.conversationId).toBe(created.id)
    expect(regenerated.phase === 'done' || regenerated.type === 'turn').toBeTruthy()

    const compacted = JSON.parse((await vavc(['session', 'compact', created.id!, ...auth])).stdout) as {
      type?: string
      conversationId?: string
    }
    expect(compacted.type).toBe('compacted')
    expect(compacted.conversationId).toBe(created.id)

    const seeded = JSON.parse((await vavc(['review', 'seed', created.id!, ...auth])).stdout) as {
      set?: { id?: string; files?: Array<{ filePath?: string }> }
    }
    expect(seeded.set?.id).toBeTruthy()
    expect(seeded.set?.files?.length).toBe(2)
    expect(seeded.set?.files?.some((file) => file.filePath?.endsWith('existing.ts'))).toBe(true)
    const accepted = JSON.parse(
      (await vavc(['review', 'accept-all', seeded.set!.id!, ...auth])).stdout
    ) as { id?: string; status?: string; files?: Array<{ status?: string }> }
    expect(accepted.id).toBe(seeded.set!.id)
    expect(accepted.status).toBe('accepted')
    expect(accepted.files?.every((file) => file.status === 'accepted')).toBe(true)
    const got = JSON.parse((await vavc(['review', 'get', seeded.set!.id!, ...auth])).stdout) as {
      id?: string
      status?: string
    }
    expect(got.id).toBe(seeded.set!.id)
    expect(got.status).toBe('accepted')

    await vavc(['session', 'delete', created.id!, ...auth])
    const afterDelete = JSON.parse((await vavc(['session', 'list', ...auth])).stdout) as Array<{
      id?: string
    }>
    expect(afterDelete.some((row) => row.id === created.id)).toBe(false)

    const rotated = JSON.parse((await vavc(['host', 'rotate', ...auth])).stdout) as { pairing?: string }
    expect(rotated.pairing).toMatch(/^vavrtp:\/\//)
    expect(rotated.pairing).not.toBe(pairing.pairing)
  } finally {
    daemon.stop()
  }
})
