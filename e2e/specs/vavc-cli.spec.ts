import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test, expect } from '@playwright/test'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import { connectPhone } from '../../src/main/cli/vavPhoneClient.ts'
import { createSession, fetchThread, setWorkspace } from '../../src/main/cli/vavControl.ts'
import { runVavcliLines, runVavcliRpc } from '../../packages/vav-cli/src/vavcliSession.ts'
import type { RemoteServerMessage } from '../../src/shared/remoteControl.ts'
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

function vavcli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ['--import', aliasHook, '--experimental-strip-types', join(root, 'packages/vav-cli/src/vavcli.ts'), ...args],
    { cwd: root, timeout: 20_000 }
  )
}

/**
 * vavc (herdr-style) and vav-cli (Claude Code-style) against a live vavd:
 * list / create / configure a session, list the planted workspace files,
 * then print a stub turn.
 */
test('vavc and vavcli cover session, files, and a printed turn', async () => {
  const daemon = await startVavd({ stubTurn: true })
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    expect(parsed?.secret).toBeTruthy()
    const auth = ['--host', '127.0.0.1', '--port', String(parsed!.port), '--secret', parsed!.secret]

    expect((await vavcli(['--help'])).stdout).toMatch(/--mode text\|json\|rpc/)

    const status = JSON.parse((await vavc(['status', ...auth])).stdout) as { ok?: boolean; sessions?: number }
    expect(status.ok).toBe(true)
    const pairing = JSON.parse((await vavc(['host', 'pairing', ...auth])).stdout) as { pairing?: string }
    expect(pairing.pairing).toMatch(/^vavrtp:\/\//)
    const incoming = JSON.parse((await vavc(['host', 'incoming', ...auth])).stdout) as {
      controllers?: Array<{ id?: string }>
    }
    expect(incoming.controllers?.length).toBeGreaterThan(0)

    const created = JSON.parse(
      (await vavc(['session', 'create', '--cwd', daemon.workspace, '--label', 'e2e-cli', ...auth])).stdout
    ) as { id?: string; title?: string }
    expect(created.id).toBeTruthy()

    const listed = JSON.parse((await vavc(['session', 'list', ...auth])).stdout) as Array<{ id?: string }>
    expect(listed.some((row) => row.id === created.id)).toBe(true)

    const files = JSON.parse(
      (await vavc(['file', 'list', daemon.workspace, ...auth])).stdout
    ) as { entries?: Array<{ name?: string }> }
    expect(files.entries?.some((entry) => entry.name === 'remote-only.md')).toBe(true)

    const read = JSON.parse(
      (await vavc(['file', 'read', join(daemon.workspace, 'remote-only.md'), ...auth])).stdout
    ) as { text?: string }
    expect(read.text).toMatch(/planted by vavd e2e/)

    const planted = join(daemon.workspace, 'remote-only.md')
    // file reveal / file open / file info — same host GUI verbs as desktop / Chrome.
    const stat = JSON.parse((await vavc(['file', 'stat', planted, ...auth])).stdout) as {
      isDirectory?: boolean
      isFile?: boolean
      size?: number
    }
    expect(stat.isFile).toBe(true)
    expect(stat.isDirectory).toBe(false)
    expect((stat.size ?? 0) > 0).toBe(true)

    const written = JSON.parse(
      (await vavc(['file', 'write', join(daemon.workspace, 'cli-out.md'), '--text', 'from vavc', ...auth]))
        .stdout
    ) as { ok?: boolean }
    expect(written.ok).toBe(true)
    // file mkdir / file rename / file rm — same fs.mkdir / rename / unlink as Chrome Files
    const madeDir = JSON.parse(
      (await vavc(['file', 'mkdir', join(daemon.workspace, 'cli-dir'), ...auth])).stdout
    ) as { ok?: boolean }
    expect(madeDir.ok).toBe(true)
    const dirExists = JSON.parse(
      (await vavc(['file', 'exists', join(daemon.workspace, 'cli-dir'), ...auth])).stdout
    ) as { exists?: boolean }
    expect(dirExists.exists).toBe(true)
    const renamedFile = JSON.parse(
      (
        await vavc([
          'file',
          'rename',
          join(daemon.workspace, 'cli-out.md'),
          join(daemon.workspace, 'cli-renamed.md'),
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(renamedFile.ok).toBe(true)
    const removedFile = JSON.parse(
      (await vavc(['file', 'rm', join(daemon.workspace, 'cli-renamed.md'), ...auth])).stdout
    ) as { ok?: boolean }
    expect(removedFile.ok).toBe(true)
    const gone = JSON.parse(
      (await vavc(['file', 'exists', join(daemon.workspace, 'cli-renamed.md'), ...auth])).stdout
    ) as { exists?: boolean }
    expect(gone.exists).toBe(false)
    // /file mkdir
    const slashMkdir = JSON.parse(
      (
        await vavcli([
          '/file',
          'mkdir',
          join(daemon.workspace, 'slash-dir'),
          '--session',
          created.id!,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(slashMkdir.ok).toBe(true)

    const revealed = JSON.parse((await vavc(['file', 'reveal', planted, ...auth])).stdout) as { ok?: boolean }
    expect(revealed.ok).toBe(true)
    const opened = JSON.parse((await vavc(['file', 'open', planted, ...auth])).stdout) as { ok?: boolean }
    expect(opened.ok).toBe(true)
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const info = JSON.parse((await vavc(['file', 'info', planted, ...auth])).stdout) as { ok?: boolean }
      expect(info.ok).toBe(true)
    }

    const fileSession = JSON.parse(
      (await vavc(['file-session', 'open', join(daemon.workspace, 'remote-only.md'), ...auth])).stdout
    ) as { fileId?: string; activeSessionId?: string }
    expect(fileSession.fileId).toBeTruthy()
    expect(fileSession.activeSessionId).toBeTruthy()

    const fileSessions = JSON.parse((await vavc(['file-session', 'list', ...auth])).stdout) as Array<{
      fileId?: string
      sessionId?: string
    }>
    expect(fileSessions.some((row) => row.fileId === fileSession.fileId)).toBe(true)
    // file-session create / file-session rename / file-session delete — same preview book as Chrome
    const extraFileSession = JSON.parse(
      (await vavc(['file-session', 'create', join(daemon.workspace, 'remote-only.md'), ...auth])).stdout
    ) as { fileId?: string; activeSessionId?: string }
    expect(extraFileSession.fileId).toBe(fileSession.fileId)
    expect(extraFileSession.activeSessionId).toBeTruthy()
    const renamedFs = JSON.parse(
      (
        await vavc([
          'file-session',
          'rename',
          extraFileSession.fileId!,
          extraFileSession.activeSessionId!,
          'CLI preview',
          ...auth
        ])
      ).stdout
    ) as { sessions?: Array<{ id?: string; title?: string }> }
    expect(renamedFs.sessions?.some((row) => row.title === 'CLI preview')).toBe(true)
    // file-session activate — History delete protects the active preview
    const activatedFs = JSON.parse(
      (
        await vavc([
          'file-session',
          'activate',
          extraFileSession.fileId!,
          fileSession.activeSessionId!,
          ...auth
        ])
      ).stdout
    ) as { activeSessionId?: string }
    expect(activatedFs.activeSessionId).toBe(fileSession.activeSessionId)
    const deletedFs = JSON.parse(
      (
        await vavc([
          'file-session',
          'delete',
          extraFileSession.fileId!,
          extraFileSession.activeSessionId!,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(deletedFs.ok).toBe(true)
    // file-session force-delete / file-session readonly — same sidebar verbs as Chrome
    const extraForced = JSON.parse(
      (await vavc(['file-session', 'create', join(daemon.workspace, 'remote-only.md'), ...auth])).stdout
    ) as { fileId?: string; activeSessionId?: string }
    const forcedFs = JSON.parse(
      (
        await vavc([
          'file-session',
          'force-delete',
          extraForced.fileId!,
          extraForced.activeSessionId!,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(forcedFs.ok).toBe(true)
    const readonlyFs = JSON.parse(
      (await vavc(['file-session', 'readonly', fileSession.activeSessionId!, 'on', ...auth])).stdout
    ) as { ok?: boolean }
    expect(readonlyFs.ok).toBe(true)
    // /file-session create
    const slashFs = JSON.parse(
      (
        await vavcli([
          '/file-session',
          'create',
          join(daemon.workspace, 'hello.md'),
          '--session',
          created.id!,
          ...auth
        ])
      ).stdout
    ) as { fileId?: string }
    expect(slashFs.fileId).toBeTruthy()

    const duplicated = JSON.parse((await vavc(['session', 'duplicate', created.id!, ...auth])).stdout) as {
      id?: string
    }
    expect(duplicated.id).toBeTruthy()
    expect(duplicated.id).not.toBe(created.id)

    await vavc(['session', 'pin', created.id!, ...auth])
    const browsed = JSON.parse(
      (await vavc(['workspace', 'browse', created.id!, ...auth])).stdout
    ) as { type?: string; entries?: unknown[] }
    expect(browsed.type).toBe('dirs')

    const browsedFiles = JSON.parse(
      (await vavc(['workspace', 'browse', created.id!, daemon.workspace, '--files', ...auth])).stdout
    ) as { type?: string; entries?: Array<{ name?: string; isDirectory?: boolean }> }
    expect(browsedFiles.entries?.some((entry) => entry.name === 'remote-only.md' && entry.isDirectory === false)).toBe(
      true
    )

    await vavc(['configure', '--session', created.id!, '--approval', 'edit', ...auth])
    const modeSession = JSON.parse(
      (await vavc(['session', 'create', '--cwd', daemon.workspace, '--label', 'e2e-mode', ...auth])).stdout
    ) as { id?: string }
    expect(modeSession.id).toBeTruthy()
    const switched = JSON.parse(
      (await vavc(['configure', '--session', modeSession.id!, '--agent', 'cursor', ...auth])).stdout
    ) as { agent?: string }
    expect(switched.agent).toBe('cursor')
    const modeSet = JSON.parse(
      (await vavc(['configure', '--session', modeSession.id!, '--mode', 'plan', ...auth])).stdout
    ) as { mode?: string | null }
    expect(modeSet.mode).toBe('plan')
    const runMode = JSON.parse(
      (await vavcli(['/run-mode', 'agent', '--session', modeSession.id!, ...auth])).stdout
    ) as { mode?: string | null }
    expect(runMode.mode).toBe('agent')

    const usage = JSON.parse((await vavc(['session', 'usage', created.id!, ...auth])).stdout) as {
      conversation?: { id?: string; tokensUsed?: number }
    }
    expect(usage.conversation?.id).toBe(created.id)

    const git = JSON.parse((await vavc(['git', 'status', daemon.workspace, ...auth])).stdout) as {
      isRepo?: boolean
    }
    expect(typeof git.isRepo).toBe('boolean')

    const bare = join(daemon.workspace, 'bare-init')
    mkdirSync(bare, { recursive: true })
    // git init — same host verb as desktop / Chrome Git tab
    const inited = JSON.parse((await vavc(['git', 'init', bare, ...auth])).stdout) as {
      ok?: boolean
      data?: { isRepo?: boolean }
    }
    expect(inited.ok).toBe(true)
    expect(inited.data?.isRepo).toBe(true)
    const gitInitSlash = JSON.parse(
      (await vavcli(['/git', 'init', bare, '--session', created.id!, ...auth])).stdout
    ) as { ok?: boolean; data?: { isRepo?: boolean } }
    expect(gitInitSlash.ok).toBe(true)
    expect(gitInitSlash.data?.isRepo).toBe(true)
    // git branch / git checkout / git worktree — same Git tab as Chrome / desktop
    const branched = JSON.parse(
      (await vavc(['git', 'branch', 'cli-e2e', '--cwd', bare, '--checkout', ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof branched.ok).toBe('boolean')
    const checkedOut = JSON.parse(
      (await vavc(['git', 'checkout', 'main', '--cwd', bare, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof checkedOut.ok).toBe('boolean')
    const worktree = JSON.parse(
      (
        await vavc([
          'git',
          'worktree',
          join(daemon.workspace, 'bare-wt'),
          '--new-branch',
          'cli-wt',
          '--cwd',
          bare,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(typeof worktree.ok).toBe('boolean')
    // /git branch
    const slashBranch = JSON.parse(
      (
        await vavcli([
          '/git',
          'branch',
          'cli-e2e-slash',
          '--cwd',
          bare,
          '--checkout',
          '--session',
          created.id!,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(typeof slashBranch.ok).toBe('boolean')

    const logs = JSON.parse((await vavc(['logs', ...auth])).stdout) as { entries?: unknown[] } | unknown[]
    expect(logs && typeof logs === 'object').toBe(true)
    // logs stats / logs export / logs clear — same Settings → Logs verbs as Chrome
    const logStats = JSON.parse((await vavc(['logs', 'stats', ...auth])).stdout) as { total?: number }
    expect(typeof logStats.total).toBe('number')
    const exportedLogs = JSON.parse((await vavc(['logs', 'export', ...auth])).stdout) as { text?: string }
    expect(typeof exportedLogs.text).toBe('string')
    // /logs stats
    const slashLogStats = JSON.parse(
      (await vavcli(['/logs', 'stats', '--session', created.id!, ...auth])).stdout
    ) as { total?: number }
    expect(typeof slashLogStats.total).toBe('number')
    // logs record / /logs record — same logs.record user channel as Chrome Settings → Logs
    const recorded = JSON.parse(
      (await vavc(['logs', 'record', '--event', 'cli.e2e', '--message', 'cli-log-row', ...auth])).stdout
    ) as { ok?: boolean }
    expect(recorded.ok).toBe(true)
    const foundLogs = JSON.parse(
      (await vavc(['logs', '--query', '{"search":"cli-log-row"}', ...auth])).stdout
    ) as { records?: Array<{ message?: string }> }
    expect(foundLogs.records?.some((row) => row.message?.includes('cli-log-row'))).toBe(true)
    const slashRecorded = JSON.parse(
      (
        await vavcli([
          '/logs',
          'record',
          '--event',
          'cli.e2e',
          '--message',
          'slash-log-row',
          '--session',
          created.id!,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean }
    expect(slashRecorded.ok).toBe(true)
    // logs tail / /logs tail — same logs.subscribe append stream as Chrome Settings → Logs
    const tailed = JSON.parse(
      (
        await vavc([
          'logs',
          'tail',
          '--count',
          '1',
          '--timeout',
          '4000',
          '--event',
          'cli.tail',
          '--message',
          'tail-row',
          ...auth
        ])
      ).stdout
    ) as { stream?: string; records?: Array<{ message?: string }> }
    expect(tailed.stream).toBeTruthy()
    expect(tailed.records?.some((row) => row.message?.includes('tail-row'))).toBe(true)
    const slashTail = JSON.parse(
      (
        await vavcli([
          '/logs',
          'tail',
          '--count',
          '1',
          '--timeout',
          '4000',
          '--event',
          'cli.tail',
          '--message',
          'slash-tail-row',
          '--session',
          created.id!,
          ...auth
        ])
      ).stdout
    ) as { records?: Array<{ message?: string }> }
    expect(slashTail.records?.some((row) => row.message?.includes('slash-tail-row'))).toBe(true)
    const clearedLogs = JSON.parse((await vavc(['logs', 'clear', 'ephemeral', ...auth])).stdout) as {
      removed?: number
    }
    expect(typeof clearedLogs.removed).toBe('number')

    await vavc(['session', 'star', created.id!, ...auth])
    const pinnedSlash = (await vavcli(['/pin', '--session', created.id!, ...auth])).stdout.trim()
    expect(pinnedSlash).toBe('pinned')
    const starredSlash = (await vavcli(['/star', '--session', created.id!, ...auth])).stdout.trim()
    expect(starredSlash).toBe('starred')

    const pluginsSlash = JSON.parse(
      (await vavcli(['/plugins', '--session', created.id!, ...auth])).stdout
    ) as { host?: string; plugins?: unknown[] }
    expect(pluginsSlash.host).toBe('vav')
    expect(Array.isArray(pluginsSlash.plugins)).toBe(true)
    const connectorsSlash = JSON.parse(
      (await vavcli(['/connectors', '--session', created.id!, ...auth])).stdout
    ) as unknown[]
    expect(Array.isArray(connectorsSlash)).toBe(true)
    expect(connectorsSlash.some((row) => typeof row === 'object' && row && 'id' in row && row.id === 'github')).toBe(
      true
    )
    const logsSlash = JSON.parse((await vavcli(['/logs', '--session', created.id!, ...auth])).stdout) as unknown
    expect(logsSlash && typeof logsSlash === 'object').toBe(true)

    const plugins = JSON.parse((await vavc(['plugins', 'list', ...auth])).stdout) as {
      host?: string
      plugins?: unknown[]
    }
    expect(plugins.host).toBe('vav')
    expect(Array.isArray(plugins.plugins)).toBe(true)
    // plugins create — same host verb as desktop / Chrome Plugins tab
    const createdPlugin = JSON.parse(
      (await vavc(['plugins', 'create', 'skill', 'e2e-notes', ...auth])).stdout
    ) as {
      ok?: boolean
      snapshot?: { plugins?: Array<{ skills?: Array<{ name?: string }> }> }
    }
    expect(createdPlugin.ok).toBe(true)
    expect(
      createdPlugin.snapshot?.plugins?.some((row) =>
        row.skills?.some((skill) => skill.name === 'e2e-notes')
      )
    ).toBe(true)
    const viaCliPlugin = JSON.parse(
      (await vavcli(['/plugins', 'create', 'skill', 'e2e-cli-notes', '--session', created.id!, ...auth]))
        .stdout
    ) as { ok?: boolean; snapshot?: { plugins?: Array<{ skills?: Array<{ name?: string }> }> } }
    expect(viaCliPlugin.ok).toBe(true)
    expect(
      viaCliPlugin.snapshot?.plugins?.some((row) =>
        row.skills?.some((skill) => skill.name === 'e2e-cli-notes')
      )
    ).toBe(true)

    const createdTimer = JSON.parse((await vavc(['timers', 'create', ...auth])).stdout) as {
      job?: { id?: string }
      conversation?: { id?: string; sessionKind?: string }
    }
    expect(createdTimer.job?.id).toBeTruthy()
    expect(createdTimer.conversation?.sessionKind).toBe('timer')

    const timers = JSON.parse((await vavc(['timers', 'list', ...auth])).stdout) as Array<{ id?: string }>
    expect(timers.some((row) => row.id === createdTimer.job?.id)).toBe(true)
    // timers update / timers get — same timers.updateJob / getJobForConversation as the Schedule editor
    const updatedTimer = JSON.parse(
      (
        await vavc([
          'timers',
          'update',
          createdTimer.job!.id!,
          '--title',
          'CLI timer',
          '--prompt',
          'ping',
          '--enabled',
          'off',
          ...auth
        ])
      ).stdout
    ) as { id?: string; title?: string; prompt?: string; enabled?: boolean }
    expect(updatedTimer.id).toBe(createdTimer.job?.id)
    expect(updatedTimer.title).toBe('CLI timer')
    expect(updatedTimer.prompt).toBe('ping')
    expect(updatedTimer.enabled).toBe(false)
    const timerForConversation = JSON.parse(
      (await vavc(['timers', 'get', createdTimer.conversation!.id!, ...auth])).stdout
    ) as { id?: string }
    expect(timerForConversation.id).toBe(createdTimer.job?.id)
    // timers runs / timers sessions / timers remove — same tray Chrome / desktop Timers reads
    const timerRuns = JSON.parse(
      (await vavc(['timers', 'runs', createdTimer.job!.id!, ...auth])).stdout
    ) as unknown[]
    expect(Array.isArray(timerRuns)).toBe(true)
    const timerSessions = JSON.parse((await vavc(['timers', 'sessions', ...auth])).stdout) as unknown[]
    expect(Array.isArray(timerSessions)).toBe(true)
    // /timers create — same timers.createScheduled as the desktop tray
    const slashCreatedTimer = JSON.parse((await vavcli(['/timers', 'create', ...auth])).stdout) as {
      job?: { id?: string }
    }
    expect(slashCreatedTimer.job?.id).toBeTruthy()
    // /timers update
    const slashUpdatedTimer = JSON.parse(
      (
        await vavcli([
          '/timers',
          'update',
          slashCreatedTimer.job!.id!,
          '--title',
          'slash timer',
          ...auth
        ])
      ).stdout
    ) as { title?: string }
    expect(slashUpdatedTimer.title).toBe('slash timer')
    const slashRemoved = JSON.parse(
      (await vavcli(['/timers', 'remove', slashCreatedTimer.job!.id!, ...auth])).stdout
    )
    expect(slashRemoved).toBe(true)
    const removedTimer = JSON.parse(
      (await vavc(['timers', 'remove', createdTimer.job!.id!, ...auth])).stdout
    )
    expect(removedTimer).toBe(true)

    const connectors = JSON.parse((await vavc(['connectors', ...auth])).stdout) as Array<{ id?: string }>
    expect(connectors.some((row) => row.id === 'github')).toBe(true)
    // connectors auth / connectors status — same catalog Chrome Settings → Connectors reads
    const connectorAuth = JSON.parse((await vavc(['connectors', 'auth', ...auth])).stdout) as {
      rows?: unknown[]
      login?: { status?: string }
    }
    expect(Array.isArray(connectorAuth.rows)).toBe(true)
    const probed = JSON.parse(
      (await vavc(['connectors', 'probe', '--cwd', daemon.workspace, ...auth])).stdout
    )
    expect(Array.isArray(probed)).toBe(true)
    const cfStatus = JSON.parse(
      (await vavc(['connectors', 'status', 'cloudflare', '--cwd', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean; error?: string }
    expect(cfStatus).toBeTruthy()
    // connectors act — same connectors.act deploy as the Chrome / desktop vendor tray
    const connectorActed = JSON.parse(
      (await vavc(['connectors', 'act', 'github', 'deploy', '--cwd', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean; code?: string }
    expect(connectorActed.ok).toBe(false)
    expect(connectorActed.code).toBe('read-only')
    // /connectors act
    const slashActed = JSON.parse(
      (
        await vavcli([
          '/connectors',
          'act',
          'github',
          'deploy',
          '--cwd',
          daemon.workspace,
          ...auth
        ])
      ).stdout
    ) as { ok?: boolean; code?: string }
    expect(slashActed.ok).toBe(false)
    expect(slashActed.code).toBe('read-only')
    const slashAuth = JSON.parse((await vavcli(['/connectors', 'auth', ...auth])).stdout) as {
      rows?: unknown[]
    }
    expect(Array.isArray(slashAuth.rows)).toBe(true)

    const pulls = JSON.parse(
      (await vavc(['github', 'pulls', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof pulls.ok).toBe('boolean')
    // github actions / github releases / github pages — same panel Chrome / desktop GitHub tray reads
    const actions = JSON.parse(
      (await vavc(['github', 'actions', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof actions.ok).toBe('boolean')
    const releases = JSON.parse(
      (await vavc(['github', 'releases', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof releases.ok).toBe('boolean')
    const pages = JSON.parse(
      (await vavc(['github', 'pages', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof pages.ok).toBe('boolean')
    const slashActions = JSON.parse(
      (await vavcli(['/github', 'actions', '--session', created.id!, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof slashActions.ok).toBe('boolean')
    // github pull / github run / /github pull — same getPull / getActionRun as the desktop tray
    const onePull = JSON.parse(
      (await vavc(['github', 'pull', '1', '--cwd', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof onePull.ok).toBe('boolean')
    const oneRun = JSON.parse(
      (await vavc(['github', 'run', '1', '--cwd', daemon.workspace, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof oneRun.ok).toBe('boolean')
    const slashPull = JSON.parse(
      (await vavcli(['/github', 'pull', '1', '--session', created.id!, ...auth])).stdout
    ) as { ok?: boolean }
    expect(typeof slashPull.ok).toBe('boolean')

    const filesSlash = JSON.parse(
      (await vavcli(['/files', daemon.workspace, '--session', created.id!, ...auth])).stdout
    ) as {
      type?: string
      entries?: Array<{ name?: string }>
    }
    expect(filesSlash.type).toBe('dirs')
    expect(filesSlash.entries?.some((entry) => entry.name === 'remote-only.md')).toBe(true)

    const settingsSlash = JSON.parse((await vavcli(['/settings', '--session', created.id!, ...auth])).stdout) as {
      defaultModel?: string
    }
    expect(settingsSlash.defaultModel).toBeTruthy()

    const exported = JSON.parse((await vavcli(['/export', '--session', created.id!, ...auth])).stdout) as {
      session?: { id?: string }
      thread?: { messages?: unknown[] }
    }
    expect(exported.session?.id).toBe(created.id)
    expect(Array.isArray(exported.thread?.messages)).toBe(true)

    const cost = JSON.parse((await vavcli(['/cost', '--session', created.id!, ...auth])).stdout) as {
      session?: string
      tokensUsed?: number
    }
    expect(cost.session).toBe(created.id)
    expect(typeof cost.tokensUsed).toBe('number')

    const gitSlash = JSON.parse(
      (await vavcli(['/git', daemon.workspace, '--session', created.id!, ...auth])).stdout
    ) as {
      isRepo?: boolean
    }
    expect(typeof gitSlash.isRepo).toBe('boolean')

    const timersSlash = JSON.parse((await vavcli(['/timers', '--session', created.id!, ...auth])).stdout) as unknown[]
    expect(Array.isArray(timersSlash)).toBe(true)

    const initPath = (await vavcli(['/init', '--session', created.id!, ...auth])).stdout.trim()
    expect(initPath).toMatch(/AGENTS\.md$/)
    const agentsMd = JSON.parse((await vavc(['file', 'read', initPath, ...auth])).stdout) as { text?: string }
    expect(agentsMd.text).toMatch(/Written by `vav-cli \/init`/)

    const turn = JSON.parse(
      (
        await vavcli(['--mode', 'json', '-p', 'hello from e2e vav-cli', '--session', created.id!, ...auth])
      ).stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .at(-1) || '{}'
    ) as { type?: string; phase?: string; conversationId?: string }
    expect(turn.type).toBe('turn')
    expect(turn.phase).toBe('done')
    expect(turn.conversationId).toBe(created.id)

    const edited = JSON.parse(
      (await vavcli(['/edit', 'edited from vav-cli', '--session', created.id!, ...auth])).stdout
    ) as { type?: string; phase?: string }
    expect(edited.type).toBe('turn')
    expect(edited.phase).toBe('done')

    const continued = (await vavcli(['/continue', '--session', created.id!, ...auth])).stdout.trim()
    expect(continued).toMatch(/^session /)
    expect(continued).not.toBe(`session ${created.id}`)

    const thread = JSON.parse((await vavc(['session', 'attach', created.id!, ...auth])).stdout) as {
      messages?: Array<{ id?: string; role?: string }>
    }
    const assistant = [...(thread.messages ?? [])].reverse().find((row) => row.role === 'assistant')
    expect(assistant?.id).toBeTruthy()
    const regenerated = JSON.parse(
      (await vavc(['session', 'regenerate', created.id!, assistant!.id!, ...auth])).stdout
    ) as { conversationId?: string; phase?: string }
    expect(regenerated.conversationId).toBe(created.id)
    expect(regenerated.phase).toBe('done')

    const compacted = JSON.parse((await vavc(['session', 'compact', created.id!, ...auth])).stdout) as {
      type?: string
      ok?: boolean
      conversationId?: string
    }
    expect(compacted.type).toBe('compacted')
    expect(compacted.conversationId).toBe(created.id)
    expect(typeof compacted.ok).toBe('boolean')

    const accounts = JSON.parse((await vavc(['account', 'list', ...auth])).stdout) as {
      accounts?: Array<{ id?: string }>
    }
    expect(Array.isArray(accounts.accounts)).toBe(true)
    const drafted = JSON.parse((await vavc(['account', 'draft', '--agent', 'vav', ...auth])).stdout) as {
      id?: string
    }
    expect(drafted.id).toBeTruthy()
    // account verify — draft has no key yet (same accounts.verify as Chrome Settings)
    const verified = JSON.parse((await vavc(['account', 'verify', drafted.id!, ...auth])).stdout) as {
      ok?: boolean
    }
    expect(verified.ok).toBe(false)
    // account update / account reveal / account current / account activate
    const updatedAccount = JSON.parse(
      (
        await vavc([
          'account',
          'update',
          drafted.id!,
          '--alias',
          'CLI e2e',
          '--key',
          'sk-e2e-cli',
          ...auth
        ])
      ).stdout
    ) as { accounts?: Array<{ id?: string; alias?: string | null }> }
    expect(updatedAccount.accounts?.some((row) => row.id === drafted.id)).toBe(true)
    const revealedKey = JSON.parse((await vavc(['account', 'reveal', drafted.id!, ...auth])).stdout) as {
      key?: string | null
    }
    expect(revealedKey.key).toBe('sk-e2e-cli')
    const currentAccount = JSON.parse(
      (await vavc(['account', 'current', drafted.id!, ...auth])).stdout
    ) as { accounts?: unknown[] }
    expect(Array.isArray(currentAccount.accounts)).toBe(true)
    const activated = JSON.parse((await vavc(['account', 'activate', drafted.id!, ...auth])).stdout) as {
      result?: { kind?: string }
    }
    expect(activated.result?.kind).toBe('switched')
    // /account reveal
    const slashReveal = JSON.parse(
      (await vavcli(['/account', 'reveal', drafted.id!, '--session', created.id!, ...auth])).stdout
    ) as { key?: string | null }
    expect(slashReveal.key).toBe('sk-e2e-cli')
    await vavc(['account', 'remove', drafted.id!, ...auth])

    // account oauth / account cancel — same accounts.beginOAuth / cancelOAuth as desktop Settings
    const cancelled = JSON.parse(
      (await vavc(['account', 'cancel', '--agent', 'grok', ...auth])).stdout
    ) as { accounts?: unknown[] }
    expect(Array.isArray(cancelled.accounts)).toBe(true)
    await expect(vavc(['account', 'oauth', '--agent', 'not-a-host', ...auth])).rejects.toMatchObject({
      stderr: expect.stringMatching(/找不到这个账户|That account is gone|missing/i)
    })
    const slashCancel = JSON.parse((await vavcli(['/account', 'cancel', 'grok', ...auth])).stdout) as {
      accounts?: unknown[]
    }
    expect(Array.isArray(slashCancel.accounts)).toBe(true)

    const hostSettings = JSON.parse((await vavc(['settings', ...auth])).stdout) as {
      defaultModel?: string
    }
    expect(hostSettings.defaultModel).toBeTruthy()
    const updatedSettings = JSON.parse(
      (await vavc(['settings', 'set', '--approval', 'edit', ...auth])).stdout
    ) as { defaultApprovalMode?: string }
    expect(updatedSettings.defaultApprovalMode).toBe('edit')
    // settings secret / settings hint / settings reveal-secret — same settings.setSecret as Chrome
    const secretSet = JSON.parse(
      (await vavc(['settings', 'secret', 'api', '--set', 'sk-e2e-legacy', ...auth])).stdout
    ) as { hint?: string | null; apiKeyPresent?: boolean }
    expect(secretSet.apiKeyPresent).toBe(true)
    expect(secretSet.hint).toBeTruthy()
    const secretHint = JSON.parse((await vavc(['settings', 'hint', 'api', ...auth])).stdout) as {
      hint?: string | null
    }
    expect(secretHint.hint).toBeTruthy()
    const secretRevealed = JSON.parse(
      (await vavc(['settings', 'reveal-secret', 'api', ...auth])).stdout
    ) as { key?: string | null }
    expect(secretRevealed.key).toBe('sk-e2e-legacy')
    // /settings secret
    const slashSecret = JSON.parse(
      (
        await vavcli([
          '/settings',
          'secret',
          'braveSearch',
          '--set',
          'sk-e2e-brave',
          '--session',
          created.id!,
          ...auth
        ])
      ).stdout
    ) as { hint?: string | null }
    expect(slashSecret.hint).toBeTruthy()

    const pane = JSON.parse(
      (await vavc(['pane', 'run', '--cwd', daemon.workspace, 'echo', 'vavc-pty', ...auth])).stdout
    ) as { output?: string; stream?: string }
    expect(pane.stream).toBeTruthy()
    expect(pane.output).toMatch(/vavc-pty/)

    // pane spawn / pane write / pane kill — same pty.spawn / write / kill as desktop New bash
    const spawned = JSON.parse(
      (await vavc(['pane', 'spawn', '--cwd', daemon.workspace, '--file', '/bin/cat', ...auth])).stdout
    ) as { stream?: string; pid?: number }
    expect(spawned.stream).toBeTruthy()
    const paneWritten = JSON.parse(
      (await vavc(['pane', 'write', spawned.stream!, 'echo vavc-spawn', ...auth])).stdout
    ) as { ok?: boolean }
    expect(paneWritten).toBeTruthy()
    await vavc(['pane', 'kill', spawned.stream!, ...auth])

    const seeded = JSON.parse((await vavc(['review', 'seed', created.id!, ...auth])).stdout) as {
      set?: { id?: string; files?: Array<{ filePath?: string }> }
    }
    expect(seeded.set?.id).toBeTruthy()
    expect(seeded.set?.files?.some((file) => file.filePath?.endsWith('added.ts'))).toBe(true)
    const viaCli = JSON.parse(
      (await vavcli(['/review', 'get', seeded.set!.id!, '--session', created.id!, ...auth])).stdout
    ) as { id?: string; files?: Array<{ filePath?: string }> }
    expect(viaCli.id).toBe(seeded.set!.id)
    expect(viaCli.files?.some((file) => file.filePath?.endsWith('existing.ts'))).toBe(true)
    const accepted = JSON.parse(
      (await vavcli(['/review', 'accept-all', seeded.set!.id!, '--session', created.id!, ...auth])).stdout
    ) as { id?: string; status?: string }
    expect(accepted.id).toBe(seeded.set!.id)
    expect(accepted.status).toBe('accepted')

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

/**
 * `vavcli --mode rpc` and the interactive prompt+slash loop, driven in-process
 * against a live vavd (child-process stdin RPC deadlocks under Electron-as-Node).
 */
test('vavcli rpc prompt/quit and scripted REPL against a live vavd', async () => {
  const daemon = await startVavd({ stubTurn: true })
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    expect(parsed?.secret).toBeTruthy()
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: parsed!.port,
      secret: parsed!.secret,
      device: 'vavcli-rpc'
    })
    try {
      const session = await createSession(phone)
      await setWorkspace(phone, session.id, daemon.workspace)

      const rpcCode = await runVavcliRpc(phone, session.id, [
        JSON.stringify({ type: 'prompt', text: 'hello from rpc' }),
        JSON.stringify({ type: 'quit' })
      ])
      expect(rpcCode).toBe(0)

      const rpcThread = await fetchThread(phone, session.id)
      expect(rpcThread && rpcThread.type === 'thread').toBe(true)
      const rpcMessages = rpcThread && rpcThread.type === 'thread' ? rpcThread.messages : []
      expect(rpcMessages.some((row) => row.role === 'user' && row.text.includes('hello from rpc'))).toBe(true)
      expect(rpcMessages.some((row) => row.role === 'assistant' && row.text.includes('e2e stub reply'))).toBe(true)

      const replCode = await runVavcliLines(phone, session.id, ['/help', 'hello from repl', '/quit'])
      expect(replCode).toBe(0)
      const replThread = await fetchThread(phone, session.id)
      const replMessages = replThread && replThread.type === 'thread' ? replThread.messages : []
      expect(replMessages.some((row) => row.role === 'user' && row.text.includes('hello from repl'))).toBe(true)
    } finally {
      phone.close()
    }
  } finally {
    daemon.stop()
  }
})

async function waitForAwaiting(
  phone: { frames: RemoteServerMessage[] },
  conversationId: string
): Promise<Extract<RemoteServerMessage, { type: 'turn' }>> {
  const isAwaiting = (msg: RemoteServerMessage): boolean =>
    msg.type === 'turn' && msg.conversationId === conversationId && Boolean(msg.awaiting?.id)
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const row = phone.frames.findLast((msg) => isAwaiting(msg))
    if (row && row.type === 'turn' && row.awaiting?.id) return row
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('no awaiting turn')
}

async function waitForBuf(read: () => string, needle: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (read().includes(needle)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timeout waiting for ${JSON.stringify(needle)}; saw ${JSON.stringify(read())}`)
}

/**
 * Real TTY path (`runInteractive` + readline), not the in-process `runVavcliLines`
 * helper. Proves vav-cli prints the host reply at the `vav-cli>` prompt.
 */
test('vavcli TTY REPL prints the stub reply', async () => {
  test.setTimeout(60_000)
  const daemon = await startVavd({ stubTurn: true })
  let proc: { write: (data: string) => void; kill: () => void; onData: (h: (d: string) => void) => void } | undefined
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    expect(parsed?.secret).toBeTruthy()
    const auth = ['--host', '127.0.0.1', '--port', String(parsed!.port), '--secret', parsed!.secret]
    const created = JSON.parse(
      (await vavc(['session', 'create', '--cwd', daemon.workspace, '--label', 'e2e-tty', ...auth])).stdout
    ) as { id?: string }
    expect(created.id).toBeTruthy()

    const { spawn: spawnPty } = await import('node-pty')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawnPty(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-cli/src/vavcli.ts'),
        '--session',
        created.id!,
        ...auth
      ],
      {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd: root,
        env
      }
    )
    proc = child
    let buf = ''
    child.onData((data) => {
      buf += data
    })
    await waitForBuf(() => buf, 'vav-cli>', 20_000)
    await new Promise((resolve) => setTimeout(resolve, 300))
    child.write('hello from tty\n')
    await waitForBuf(() => buf, 'e2e stub reply', 20_000)
    child.write('/quit\n')
  } finally {
    try {
      proc?.kill()
    } catch {
      // already exited
    }
    daemon.stop()
  }
})

test('vavcli rpc reply completes a parked Approve on live vavd', async () => {
  const daemon = await startVavd({ stubTurn: true, stubApprove: true })
  try {
    const parsed = parseDaemonPairing(daemon.pairing)
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: parsed!.port,
      secret: parsed!.secret,
      device: 'vavcli-reply'
    })
    try {
      await phone.wait((msg) => msg.type === 'host')
      const session = await createSession(phone)
      await setWorkspace(phone, session.id, daemon.workspace)
      phone.send({ type: 'send', conversationId: session.id, text: 'approve this' })
      const parked = await waitForAwaiting(phone, session.id)
      const code = await runVavcliRpc(phone, session.id, [
        JSON.stringify({ type: 'reply', toolCallId: parked.awaiting!.id, answer: 'Approve' }),
        JSON.stringify({ type: 'quit' })
      ])
      expect(code).toBe(0)
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
