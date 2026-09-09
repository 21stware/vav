#!/usr/bin/env node
/**
 * vav-board — herdr-style control client for a running vav-server.
 *
 * Same phone protocol as VAV Remote, the web UI, and the Chrome extension.
 * Sessions on this CLI are the same sessions the desktop app paints.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findVavServerEntry, resolveNodeForVavServer, vavServerNodeArgs } from '@main/daemon/vavServerSpawn.ts'
import { probeListenAlive, readListenState } from '@main/daemon/listenState.ts'
import {
  applyGoal,
  archiveSession,
  browseWorkspace,
  cancelSession,
  compactSession,
  configureSession,
  continueSession,
  deleteMessage,
  duplicateSession,
  editSession,
  forkSession,
  createSession,
  locateWorkspace,
  regenerateSession,
  favoriteSession,
  fetchControls,
  fetchThread,
  listSessions,
  pinSession,
  printJson,
  printLine,
  renameSession,
  replySession,
  resolveSession,
  sendTurn,
  setLeaf,
  setWorkspace,
  waitSessionStatus
} from '@main/cli/vavControl.ts'
import {
  getDaemonSession,
  gitDiff,
  gitInit,
  gitCreateBranch,
  gitCheckoutBranch,
  gitCreateWorktree,
  gitShowBase64,
  openFileSession,
  gitStatus,
  hostInfo,
  hostPairing,
  hostRotateOffer,
  hostIncoming,
  hostDisconnectIncoming,
  hostUnpairIncoming,
  killPane,
  beginConnectorLogin,
  cancelConnectorLoginCli,
  connectorAuthStatus,
  connectorVendorStatus,
  probeConnectors,
  beginAccountOAuth,
  cancelAccountOAuth,
  createAccount,
  draftAccount,
  updateAccount,
  setCurrentAccount,
  activateAccount,
  verifyAccount,
  revealAccountKey,
  getHostSettings,
  listAccounts,
  signOutAccount,
  updateHostSettings,
  setHostSecret,
  hintHostSecret,
  revealHostSecret,
  listConnectors,
  removeAccount,
  listFileSessions,
  createFileSession,
  renameFileSession,
  deleteFileSessions,
  activateFileSession,
  forceDeleteFileSessions,
  setFileSessionReadOnly,
  listFiles,
  getGithubActionRunCli,
  getGithubPullCli,
  getGithubSiteCli,
  listGithubActionsCli,
  listGithubPulls,
  listGithubReleasesCli,
  createPlugin,
  listPlugins,
  setPluginEnabled,
  writePluginConfig,
  listRecentWorkspaces,
  listTimers,
  createTimer,
  createTimerJob,
  getTimerForConversation,
  parseTimerPatch,
  updateTimer,
  runTimer,
  removeTimer,
  listTimerRuns,
  listTimerSessions,
  connectorAct,
  queryLogs,
  logsStats,
  clearLogs,
  exportLogs,
  recordLog,
  tailLogs,
  getInfoFile,
  openFile,
  readFileText,
  revealFile,
  runPaneCommand,
  spawnPane,
  statFile,
  withDaemon,
  writeFileText,
  mkdirFile,
  renameFile,
  unlinkFile,
  existsFile,
  writePane,
  seedReview,
  activeReview,
  getReview,
  acceptReview,
  rejectReview,
  acceptAllReview,
  rejectAllReview,
  undoReview
} from '@main/cli/vavDaemonCli.ts'
import { connectPhoneTarget } from '@main/cli/vavPhoneClient.ts'
import {
  TARGET_FLAGS,
  argValueOrEq,
  defaultStateDirs,
  formatTarget,
  positionalArgs,
  resolveVavServerTarget,
  secretFromState
} from '@main/cli/vavServerTarget.ts'

const CONTROL_FLAGS = new Set([
  ...TARGET_FLAGS,
  '--cwd',
  '--label',
  '--session',
  '--model',
  '--approval',
  '--thinking',
  '--agent',
  '--mode',
  '--kind',
  '--timeout',
  '--until',
  '--listen',
  '--text',
  '--file',
  '--shell',
  '--cols',
  '--rows',
  '--path',
  '--tool',
  '--signal',
  '--query',
  '--title',
  '--prompt',
  '--enabled',
  '--cron',
  '--every-ms',
  '--once-at',
  '--new-branch',
  '--newBranch',
  '--branch',
  '--ref',
  '--name',
  '--alias',
  '--key',
  '--event',
  '--message',
  '--workspace',
  '--set',
  '--count'
])

const CONTROL_BOOL = new Set([
  '--json',
  '--wait',
  '--focus',
  '--no-focus',
  '--force',
  '--staged',
  '--checkout',
  '--no-recursive'
])

export function vavBoardHelp(): string {
  return [
    'vav-board — herdr-style control client for a running vav-server',
    '',
    '  vav-board status',
    '  vav-board server              start vav-server in the foreground if none is up',
    '  vav-board session list',
    '  vav-board session create [--cwd PATH] [--label TEXT] [--model ID]',
    '  vav-board session get <id>',
    '  vav-board session attach <id>',
    '  vav-board session stop <id>',
    '  vav-board session delete <id>',
    '  vav-board session rename <id> <title>',
    '  vav-board session compact <id>',
    '  vav-board session duplicate <id>',
    '  vav-board session continue <id> <messageId>',
    '  vav-board session regenerate <id> <messageId>',
    '  vav-board session edit <id> <messageId> <text>',
    '  vav-board session fork <id> <messageId>',
    '  vav-board session goal <id> <set|pause|resume|clear> [objective]',
    '  vav-board session locate <id> <dir>',
    '  vav-board session delete-message <id> <messageId>',
    '  vav-board session leaf <id> <messageId>',
    '  vav-board session pin <id> | unpin <id> | star <id> | unstar <id>',
    '  vav-board session reply <id> <toolCallId> <answer>',
    '  vav-board session usage <id>',
    '  vav-board workspace list | recents',
    '  vav-board workspace create [--cwd PATH] [--label TEXT]',
    '  vav-board workspace get <id>',
    '  vav-board workspace focus <id> [--cwd PATH]',
    '  vav-board workspace browse <id> [path] [--files]',
    '  vav-board workspace close <id>',
    '  vav-board agent list',
    '  vav-board agent get <id>',
    '  vav-board agent prompt <id> <text> [--wait]',
    '  vav-board agent wait <id> [--until idle|done|running]',
    '  vav-board agent start --kind vav [--cwd PATH] [--label TEXT]',
    '  vav-board file list <path> | stat <path> | read <path>',
    '  vav-board file write <path> --text BODY',
    '  vav-board file mkdir <path>',
    '  vav-board file rename <from> <to> | file rm <path> | file exists <path>',
    '  vav-board file reveal <path> | open <path> | info <path>',
    '  vav-board file-session open <path> | create <path> | list [fileId]',
    '  vav-board file-session activate <fileId> <sessionId> | rename <fileId> <sessionId> <title>',
    '  vav-board file-session delete <fileId> <sessionId…> | force-delete <fileId> <sessionId…>',
    '  vav-board file-session readonly <sessionId> [on|off]',
    '  vav-board pane spawn [--cwd PATH] [--file SHELL]',
    '  vav-board pane write <stream> <text>',
    '  vav-board pane kill <stream>',
    '  vav-board pane run [--cwd PATH] -- <command…>',
    '  vav-board account list | account draft [--agent ID] | account add --name TEXT --endpoint URL --key TOKEN | account remove <id>',
    '  vav-board account update <id> [--alias TEXT] [--endpoint URL] [--key TOKEN]',
    '  vav-board account current <id> | account activate <id> | account verify <id> | account reveal <id>',
    '  vav-board account oauth --agent ID [--id ACCOUNT] | account cancel --agent ID | account signout --agent ID',
    '  vav-board settings [get] | settings set [--model ID] [--approval auto|bypass|edit] [--thinking off|low|medium|high] [--endpoint URL]',
    '  vav-board settings secret <slot> --set TOKEN | settings hint <slot> | settings reveal-secret <slot>',
    '  vav-board host [info|pairing|rotate|incoming]',
    '  vav-board host disconnect <grantId> | host unpair <grantId>',
    '  vav-board logs [query] [--query JSON] | logs stats | logs clear [all|ephemeral|session|durable] | logs export',
    '  vav-board logs record --event NAME --message TEXT',
    '  vav-board logs tail [--count N] [--timeout MS] [--event NAME --message TEXT]  (logs.subscribe)',
    '  vav-board git status [cwd] | git init [cwd] | git diff <path> [--cwd PATH]',
    '  vav-board git branch <name> [--checkout] | git checkout <name> | git worktree <path> [--new-branch NAME]',
    '  vav-board git show <path> [--ref REF] [--cwd PATH]',
    '  vav-board github pulls [cwd] [--state open|closed|all] | github pull <n> [--cwd PATH]',
    '  vav-board github actions [cwd] [--scope running|history] | github run <id> [--cwd PATH]',
    '  vav-board github releases [cwd] | github pages [cwd]',
    '  vav-board plugins list [host] | create <skill|mcp|hook|plugin> <name>',
    '  vav-board plugins enable <id> | disable <id> | write <path> --text BODY',
    '  vav-board timers list | create | add | get <conversationId> | run <id> | remove <id> | runs [id] | sessions',
    '  vav-board timers update <id> [--title TEXT] [--prompt TEXT] [--enabled on|off] [--cron EXPR]',
    '  vav-board connectors [login <id> | cancel [id] | auth | probe [--cwd PATH] | status <cloudflare|supabase|vercel> [--cwd PATH]]',
    '  vav-board connectors act <id> <action> [--cwd PATH]',
    '  vav-board review seed <id> | active <id> | get <setId>',
    '  vav-board review accept-all <setId> | reject-all <setId>',
    '  vav-board review accept <setId> [path…] | reject <setId> [path…] | undo <setId> <path>',
    '  vav-board completion zsh|bash|fish',
    '',
    'Legacy (same as older `vav`):',
    '  vav-board sessions | create | send <text> | thread | configure [--mode agent|plan|…]',
    '',
    '  --uri vavrtp://…   pairing URI (or VAV_SERVER_URI)',
    '  --host --port --secret override pieces',
    '  --state <dir>          read secret.json + listen.json (default ~/.vav-server)',
    '  --json                 force JSON (list/get already print JSON)',
    ''
  ].join('\n')
}

export function positional(argv: string[], takesValue: Set<string> = CONTROL_FLAGS): string[] {
  return positionalArgs(argv, takesValue, CONTROL_BOOL)
}

function packageVersion(): string {
  try {
    const here = typeof import.meta.dirname === 'string' ? import.meta.dirname : dirname(fileURLToPath(import.meta.url))
    const candidates = [
      join(here, '../../../package.json'),
      join(here, '../../package.json'),
      join(process.cwd(), 'package.json')
    ]
    for (const file of candidates) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
        if (typeof raw.version === 'string' && raw.version) return raw.version
      } catch {
        /* next */
      }
    }
  } catch {
    /* ignore */
  }
  return process.env.npm_package_version || '0.0.0'
}

export function completionScript(shell: string): string {
  if (shell === 'bash') {
    return `complete -W "status server session workspace agent file file-session pane account settings host logs git github plugins timers connectors review completion sessions create send thread configure help" vav-board\n`
  }
  if (shell === 'fish') {
    return [
      'complete -c vav-board -f',
      'complete -c vav-board -n "__fish_use_subcommand" -a "status server session workspace agent file file-session pane account settings host logs git github plugins timers connectors review completion"',
      'complete -c vav-board -n "__fish_seen_subcommand_from review" -a "seed active get accept reject accept-all reject-all undo"',
      'complete -c vav-board -n "__fish_seen_subcommand_from account" -a "list draft add remove update current activate verify reveal oauth cancel signout"',
      'complete -c vav-board -n "__fish_seen_subcommand_from settings" -a "get set secret hint reveal-secret"',
      'complete -c vav-board -n "__fish_seen_subcommand_from git" -a "status init diff branch checkout worktree show"',
      'complete -c vav-board -n "__fish_seen_subcommand_from github" -a "pulls pull actions run releases pages"',
      'complete -c vav-board -n "__fish_seen_subcommand_from plugins" -a "list create enable disable write"',
      'complete -c vav-board -n "__fish_seen_subcommand_from timers" -a "list create add get update run remove runs sessions"',
      'complete -c vav-board -n "__fish_seen_subcommand_from session" -a "list create get attach stop delete rename compact duplicate continue regenerate edit fork goal locate delete-message leaf pin unpin star unstar reply"',
      'complete -c vav-board -n "__fish_seen_subcommand_from file-session" -a "open create list activate rename delete force-delete readonly"',
      'complete -c vav-board -n "__fish_seen_subcommand_from logs" -a "query stats clear export record tail"',
      'complete -c vav-board -n "__fish_seen_subcommand_from workspace" -a "list recents create get focus browse close"',
      'complete -c vav-board -n "__fish_seen_subcommand_from agent" -a "list get prompt wait start"',
      'complete -c vav-board -n "__fish_seen_subcommand_from file" -a "list stat read write mkdir rename rm exists reveal open info"',
      'complete -c vav-board -n "__fish_seen_subcommand_from pane" -a "spawn write kill run"',
      ''
    ].join('\n')
  }
  return [
    '#compdef vav-board',
    '_vav-board() {',
    '  local -a cmds',
    '  cmds=(status server session workspace agent file file-session pane account settings host logs git github plugins timers connectors review completion sessions create send thread configure help)',
    '  _describe "command" cmds',
    '}',
    '_vav-board',
    ''
  ].join('\n')
}

async function withPhone<T>(argv: string[], device: string, fn: (phone: Awaited<ReturnType<typeof connectPhoneTarget>>) => Promise<T>): Promise<T> {
  const target = await resolveVavServerTarget({ argv })
  const phone = await connectPhoneTarget(target, device)
  try {
    return await fn(phone)
  } finally {
    phone.close()
  }
}

async function statusCommand(argv: string[]): Promise<number> {
  try {
    const target = await resolveVavServerTarget({ argv })
    const phone = await connectPhoneTarget(target, 'vav-board')
    try {
      const welcome = phone.frames.find((msg) => msg.type === 'welcome')
      const host = phone.frames.find((msg) => msg.type === 'host')
      const sessions = await listSessions(phone)
      printJson({
        ok: true,
        target: formatTarget(target),
        app: welcome && welcome.type === 'welcome' ? welcome.app : 'vav-server',
        version: welcome && welcome.type === 'welcome' ? welcome.version : undefined,
        host: host && host.type === 'host' ? { name: host.name, platform: host.platform } : undefined,
        sessions: sessions.length,
        running: sessions.filter((row) => row.status === 'running').length
      })
      return 0
    } finally {
      phone.close()
    }
  } catch (err) {
    printJson({ ok: false, error: err instanceof Error ? err.message : String(err) })
    return 1
  }
}

async function startServer(argv: string[]): Promise<number> {
  const state = argValueOrEq(argv, '--state') || process.env.VAV_SERVER_STATE || defaultStateDirs()[0]!
  const listen = readListenState(state)
  if (listen && (await probeListenAlive(listen))) {
    printLine(`vav-server already running on ${listen.host}:${listen.port}`)
    const secret = secretFromState(state)
    if (secret) printLine(`pass --state ${state} (or VAV_SERVER_URI) to vav-board / vav-tui`)
    return 0
  }
  const entry = findVavServerEntry(process.cwd())
  if (!entry) {
    process.stderr.write('vav-server not found — install the VAV app (Settings → Command Line) or npm i -g @21stware/vav-server\n')
    return 1
  }
  const flags = ['--state', state]
  const listenAddr = argValueOrEq(argv, '--listen')
  const port = argValueOrEq(argv, '--port')
  if (listenAddr) flags.push('--listen', listenAddr)
  if (port) flags.push('--port', port)
  const node = resolveNodeForVavServer()
  const child = spawn(node.cmd, vavServerNodeArgs(entry, flags), {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(node.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    }
  })
  const code: number | null = await new Promise((resolve) => {
    child.on('exit', (status) => resolve(status))
  })
  return code ?? 1
}

async function ensureSession(
  phone: Parameters<typeof createSession>[0],
  argv: string[],
  id: string | undefined,
  createIfMissing: boolean
) {
  const sessions = await listSessions(phone)
  const existing = resolveSession(sessions, id, createIfMissing ? 'none' : 'none')
  if (existing) return existing
  if (!createIfMissing) throw new Error('session id required')
  const session = await createSession(phone)
  const cwd = argValueOrEq(argv, '--cwd')
  const label = argValueOrEq(argv, '--label')
  const model = argValueOrEq(argv, '--model')
  if (cwd) await setWorkspace(phone, session.id, cwd)
  if (label) await renameSession(phone, session.id, label)
  if (model) await configureSession(phone, session.id, { model })
  const again = await listSessions(phone)
  return resolveSession(again, session.id) ?? session
}

export async function runVavBoard(argv: string[] = process.argv): Promise<number> {
  if (argv.includes('--version') || argv.includes('-V')) {
    printLine(packageVersion())
    return 0
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(vavBoardHelp())
    return 0
  }
  const args = positional(argv)
  const verb = args[0]
  if (!verb || verb === 'help') {
    process.stdout.write(vavBoardHelp())
    return 0
  }

  if (verb === 'completion' || verb === 'completions') {
    process.stdout.write(completionScript(args[1] || 'zsh'))
    return 0
  }
  if (verb === 'status') {
    return statusCommand(argv)
  }
  if (verb === 'server') {
    if (args[1] === 'stop') {
      process.stderr.write('send SIGTERM to the vav-server process (or quit the VAV app that spawned it)\n')
      return 2
    }
    return startServer(argv)
  }

  if (
    verb === 'host' ||
    verb === 'file' ||
    verb === 'pane' ||
    verb === 'logs' ||
    verb === 'git' ||
    verb === 'github' ||
    verb === 'plugins' ||
    verb === 'timers' ||
    verb === 'connectors' ||
    verb === 'file-session' ||
    verb === 'account' ||
    verb === 'settings' ||
    verb === 'review'
  ) {
    const target = await resolveVavServerTarget({ argv })
    return withDaemon(target, async (rpc) => {
      if (verb === 'host' && args[1] === 'pairing') {
        printJson(await hostPairing(rpc))
        return 0
      }
      if (verb === 'host' && args[1] === 'rotate') {
        printJson(await hostRotateOffer(rpc))
        return 0
      }
      if (verb === 'host' && args[1] === 'incoming') {
        printJson(await hostIncoming(rpc))
        return 0
      }
      if (verb === 'host' && args[1] === 'disconnect') {
        printJson(await hostDisconnectIncoming(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'host' && args[1] === 'unpair') {
        printJson(await hostUnpairIncoming(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'host') {
        printJson(await hostInfo(rpc))
        return 0
      }
      if (verb === 'logs' && args[1] === 'stats') {
        printJson(await logsStats(rpc))
        return 0
      }
      if (verb === 'logs' && args[1] === 'clear') {
        printJson(await clearLogs(rpc, args[2] || 'all'))
        return 0
      }
      if (verb === 'logs' && args[1] === 'export') {
        const raw = argValueOrEq(argv, '--query')
        printJson(await exportLogs(rpc, raw ? (JSON.parse(raw) as Record<string, unknown>) : {}))
        return 0
      }
      if (verb === 'logs' && args[1] === 'record') {
        printJson(
          await recordLog(rpc, {
            event: argValueOrEq(argv, '--event') || args[2] || '',
            message: argValueOrEq(argv, '--message') || args.slice(3).join(' ').trim(),
            conversationId: argValueOrEq(argv, '--session')
          })
        )
        return 0
      }
      if (verb === 'logs' && args[1] === 'tail') {
        printJson(
          await tailLogs(rpc, {
            count: Number(argValueOrEq(argv, '--count') || 0) || undefined,
            timeoutMs: Number(argValueOrEq(argv, '--timeout') || 0) || undefined,
            event: argValueOrEq(argv, '--event'),
            message: argValueOrEq(argv, '--message'),
            conversationId: argValueOrEq(argv, '--session')
          })
        )
        return 0
      }
      if (verb === 'logs') {
        const raw = argValueOrEq(argv, '--query')
        const query = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        printJson(await queryLogs(rpc, query))
        return 0
      }
      if (verb === 'account' && (args[1] === 'list' || !args[1])) {
        printJson(await listAccounts(rpc, argValueOrEq(argv, '--workspace')))
        return 0
      }
      if (verb === 'account' && args[1] === 'draft') {
        printJson(await draftAccount(rpc, argValueOrEq(argv, '--agent') || undefined))
        return 0
      }
      if (verb === 'account' && args[1] === 'add') {
        printJson(
          await createAccount(rpc, {
            name: argValueOrEq(argv, '--name') || '',
            endpoint: argValueOrEq(argv, '--endpoint') || '',
            apiKey: argValueOrEq(argv, '--key') || '',
            agentId: argValueOrEq(argv, '--agent') || undefined
          })
        )
        return 0
      }
      if (verb === 'settings' && (args[1] === 'get' || !args[1])) {
        printJson(await getHostSettings(rpc))
        return 0
      }
      if (verb === 'settings' && args[1] === 'set') {
        const patch: Record<string, unknown> = {}
        const model = argValueOrEq(argv, '--model')
        const approval = argValueOrEq(argv, '--approval')
        const thinking = argValueOrEq(argv, '--thinking')
        const endpoint = argValueOrEq(argv, '--endpoint')
        if (model) patch.defaultModel = model
        if (approval) patch.defaultApprovalMode = approval
        if (thinking) patch.defaultThinkingLevel = thinking
        if (endpoint) patch.apiEndpoint = endpoint
        if (!Object.keys(patch).length) {
          throw new Error('vav-board settings set --model ID | --approval MODE | --thinking LEVEL | --endpoint URL')
        }
        printJson(await updateHostSettings(rpc, patch))
        return 0
      }
      if (verb === 'settings' && args[1] === 'secret') {
        const slot = args[2] || ''
        const value = argValueOrEq(argv, '--set') || args[3] || ''
        printJson(await setHostSecret(rpc, slot, value))
        return 0
      }
      if (verb === 'settings' && args[1] === 'hint') {
        printJson(await hintHostSecret(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'settings' && (args[1] === 'reveal-secret' || args[1] === 'revealSecret')) {
        printJson(await revealHostSecret(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'account' && args[1] === 'remove') {
        const id = args[2]
        if (!id) throw new Error('vav-board account remove <id>')
        printJson(await removeAccount(rpc, id))
        return 0
      }
      if (verb === 'account' && args[1] === 'update') {
        const id = args[2]
        printJson(
          await updateAccount(rpc, id || '', {
            alias: argValueOrEq(argv, '--alias'),
            endpoint: argValueOrEq(argv, '--endpoint'),
            apiKey: argValueOrEq(argv, '--key')
          })
        )
        return 0
      }
      if (verb === 'account' && (args[1] === 'current' || args[1] === 'use')) {
        const id = args[2]
        if (!id) throw new Error('vav-board account current <id>')
        printJson(await setCurrentAccount(rpc, id))
        return 0
      }
      if (verb === 'account' && args[1] === 'activate') {
        const id = args[2]
        if (!id) throw new Error('vav-board account activate <id>')
        printJson(await activateAccount(rpc, id))
        return 0
      }
      if (verb === 'account' && args[1] === 'verify') {
        const id = args[2]
        if (!id) throw new Error('vav-board account verify <id>')
        printJson(await verifyAccount(rpc, id, argValueOrEq(argv, '--key')))
        return 0
      }
      if (verb === 'account' && args[1] === 'reveal') {
        const id = args[2]
        if (!id) throw new Error('vav-board account reveal <id>')
        printJson(await revealAccountKey(rpc, id))
        return 0
      }
      if (verb === 'account' && (args[1] === 'oauth' || args[1] === 'login')) {
        printJson(
          await beginAccountOAuth(
            rpc,
            argValueOrEq(argv, '--agent') || args[2] || '',
            argValueOrEq(argv, '--id') || undefined
          )
        )
        return 0
      }
      if (verb === 'account' && args[1] === 'cancel') {
        printJson(await cancelAccountOAuth(rpc, argValueOrEq(argv, '--agent') || args[2] || ''))
        return 0
      }
      if (verb === 'account' && (args[1] === 'signout' || args[1] === 'sign-out')) {
        printJson(await signOutAccount(rpc, argValueOrEq(argv, '--agent') || args[2] || ''))
        return 0
      }
      if (verb === 'file-session' && args[1] === 'open') {
        const path = args[2]
        if (!path) throw new Error('vav-board file-session open <path>')
        printJson(await openFileSession(rpc, path))
        return 0
      }
      if (verb === 'file-session' && args[1] === 'create') {
        const path = args[2]
        if (!path) throw new Error('vav-board file-session create <path>')
        printJson(await createFileSession(rpc, path))
        return 0
      }
      if (verb === 'file-session' && args[1] === 'rename') {
        const title = args.slice(4).join(' ').trim()
        if (!args[2] || !args[3] || !title) {
          throw new Error('vav-board file-session rename <fileId> <sessionId> <title>')
        }
        printJson(await renameFileSession(rpc, args[2], args[3], title))
        return 0
      }
      if (verb === 'file-session' && args[1] === 'activate') {
        if (!args[2] || !args[3]) throw new Error('vav-board file-session activate <fileId> <sessionId>')
        printJson(await activateFileSession(rpc, args[2], args[3]))
        return 0
      }
      if (verb === 'file-session' && args[1] === 'delete') {
        if (!args[2] || !args[3]) throw new Error('vav-board file-session delete <fileId> <sessionId…>')
        printJson(await deleteFileSessions(rpc, args[2], args.slice(3)))
        return 0
      }
      if (verb === 'file-session' && (args[1] === 'force-delete' || args[1] === 'forceDelete')) {
        if (!args[2] || !args[3]) {
          throw new Error('vav-board file-session force-delete <fileId> <sessionId…>')
        }
        printJson(await forceDeleteFileSessions(rpc, args[2], args.slice(3)))
        return 0
      }
      if (verb === 'file-session' && (args[1] === 'readonly' || args[1] === 'read-only')) {
        const flag = (args[3] || 'on').toLowerCase()
        if (!args[2] || (flag !== 'on' && flag !== 'off')) {
          throw new Error('vav-board file-session readonly <sessionId> [on|off]')
        }
        printJson(await setFileSessionReadOnly(rpc, args[2], flag === 'on'))
        return 0
      }
      if (verb === 'file-session' && (args[1] === 'list' || !args[1])) {
        printJson(await listFileSessions(rpc, args[2]))
        return 0
      }
      if (verb === 'file' && args[1] === 'list') {
        printJson(await listFiles(rpc, args[2] || argValueOrEq(argv, '--path') || ''))
        return 0
      }
      if (verb === 'file' && args[1] === 'stat') {
        printJson(await statFile(rpc, args[2] || argValueOrEq(argv, '--path') || ''))
        return 0
      }
      if (verb === 'file' && args[1] === 'read') {
        printJson(await readFileText(rpc, args[2] || argValueOrEq(argv, '--path') || ''))
        return 0
      }
      if (verb === 'file' && args[1] === 'write') {
        const path = args[2] || argValueOrEq(argv, '--path')
        const text = argValueOrEq(argv, '--text')
        if (!path || text == null) throw new Error('vav-board file write <path> --text BODY')
        printJson(await writeFileText(rpc, path, text))
        return 0
      }
      if (verb === 'file' && args[1] === 'mkdir') {
        const path = args[2] || argValueOrEq(argv, '--path') || ''
        if (!path) throw new Error('vav-board file mkdir <path>')
        printJson(await mkdirFile(rpc, path, !argv.includes('--no-recursive')))
        return 0
      }
      if (verb === 'file' && args[1] === 'rename') {
        const from = args[2] || argValueOrEq(argv, '--from') || ''
        const to = args[3] || argValueOrEq(argv, '--to') || ''
        if (!from || !to) throw new Error('vav-board file rename <from> <to>')
        printJson(await renameFile(rpc, from, to))
        return 0
      }
      if (verb === 'file' && (args[1] === 'rm' || args[1] === 'unlink' || args[1] === 'delete')) {
        const path = args[2] || argValueOrEq(argv, '--path') || ''
        if (!path) throw new Error('vav-board file rm <path>')
        printJson(await unlinkFile(rpc, path))
        return 0
      }
      if (verb === 'file' && args[1] === 'exists') {
        const path = args[2] || argValueOrEq(argv, '--path') || ''
        if (!path) throw new Error('vav-board file exists <path>')
        printJson(await existsFile(rpc, path))
        return 0
      }
      if (verb === 'file' && args[1] === 'reveal') {
        printJson(await revealFile(rpc, args[2] || argValueOrEq(argv, '--path') || ''))
        return 0
      }
      if (verb === 'file' && args[1] === 'open') {
        printJson(await openFile(rpc, args[2] || argValueOrEq(argv, '--path') || ''))
        return 0
      }
      if (verb === 'file' && (args[1] === 'info' || args[1] === 'get-info')) {
        printJson(await getInfoFile(rpc, args[2] || argValueOrEq(argv, '--path') || ''))
        return 0
      }
      if (verb === 'pane' && args[1] === 'spawn') {
        printJson(
          await spawnPane(rpc, {
            cwd: argValueOrEq(argv, '--cwd'),
            file: argValueOrEq(argv, '--file') || argValueOrEq(argv, '--shell'),
            cols: Number(argValueOrEq(argv, '--cols') || 80),
            rows: Number(argValueOrEq(argv, '--rows') || 24)
          })
        )
        return 0
      }
      if (verb === 'pane' && args[1] === 'write') {
        const stream = args[2]
        const text = args.slice(3).join(' ')
        if (!stream || !text) throw new Error('vav-board pane write <stream> <text>')
        printJson(await writePane(rpc, stream, text.endsWith('\n') ? text : `${text}\n`))
        return 0
      }
      if (verb === 'pane' && args[1] === 'kill') {
        const stream = args[2]
        if (!stream) throw new Error('vav-board pane kill <stream>')
        printJson(await killPane(rpc, stream, argValueOrEq(argv, '--signal')))
        return 0
      }
      if (verb === 'git' && args[1] === 'status') {
        printJson(await gitStatus(rpc, args[2] || argValueOrEq(argv, '--cwd') || process.cwd()))
        return 0
      }
      if (verb === 'git' && args[1] === 'init') {
        printJson(await gitInit(rpc, args[2] || argValueOrEq(argv, '--cwd') || process.cwd()))
        return 0
      }
      if (verb === 'git' && args[1] === 'diff') {
        const path = args[2] || argValueOrEq(argv, '--path')
        if (!path) throw new Error('vav-board git diff <path> [--cwd PATH]')
        printJson(
          await gitDiff(rpc, argValueOrEq(argv, '--cwd') || process.cwd(), path, argv.includes('--staged'))
        )
        return 0
      }
      if (verb === 'git' && (args[1] === 'branch' || args[1] === 'create-branch')) {
        const name = args[2]
        if (!name) throw new Error('vav-board git branch <name> [--cwd PATH] [--checkout]')
        printJson(
          await gitCreateBranch(
            rpc,
            argValueOrEq(argv, '--cwd') || args[3] || process.cwd(),
            name,
            argv.includes('--checkout')
          )
        )
        return 0
      }
      if (verb === 'git' && args[1] === 'checkout') {
        const name = args[2]
        if (!name) throw new Error('vav-board git checkout <name> [--cwd PATH]')
        printJson(
          await gitCheckoutBranch(rpc, argValueOrEq(argv, '--cwd') || args[3] || process.cwd(), name)
        )
        return 0
      }
      if (verb === 'git' && (args[1] === 'worktree' || args[1] === 'work-tree')) {
        const path = args[2]
        if (!path) throw new Error('vav-board git worktree <path> [--new-branch NAME|--branch NAME] [--cwd PATH]')
        printJson(
          await gitCreateWorktree(rpc, argValueOrEq(argv, '--cwd') || process.cwd(), path, {
            newBranch: argValueOrEq(argv, '--new-branch') || argValueOrEq(argv, '--newBranch'),
            branch: argValueOrEq(argv, '--branch')
          })
        )
        return 0
      }
      if (verb === 'git' && args[1] === 'show') {
        const path = args[2] || argValueOrEq(argv, '--path')
        if (!path) throw new Error('vav-board git show <path> [--ref REF] [--cwd PATH]')
        printJson(
          await gitShowBase64(
            rpc,
            argValueOrEq(argv, '--cwd') || process.cwd(),
            path,
            argValueOrEq(argv, '--ref') || 'HEAD'
          )
        )
        return 0
      }
      if (verb === 'plugins' && (args[1] === 'list' || !args[1])) {
        printJson(await listPlugins(rpc, args[2] || 'vav'))
        return 0
      }
      if (verb === 'plugins' && args[1] === 'create') {
        printJson(await createPlugin(rpc, args[2] || '', args.slice(3).join(' ')))
        return 0
      }
      if (verb === 'plugins' && (args[1] === 'enable' || args[1] === 'disable')) {
        printJson(
          await setPluginEnabled(
            rpc,
            argValueOrEq(argv, '--host') || 'vav',
            args[2] || '',
            args[1] === 'enable'
          )
        )
        return 0
      }
      if (verb === 'plugins' && args[1] === 'write') {
        const path = args[2] || argValueOrEq(argv, '--path') || ''
        const text = argValueOrEq(argv, '--text')
        if (!path || text == null) throw new Error('vav-board plugins write <path> --text BODY')
        printJson(await writePluginConfig(rpc, path, text))
        return 0
      }
      if (verb === 'github' && (args[1] === 'pulls' || args[1] === 'prs' || !args[1])) {
        printJson(
          await listGithubPulls(
            rpc,
            args[2] || argValueOrEq(argv, '--cwd') || process.cwd(),
            argValueOrEq(argv, '--state') || 'open'
          )
        )
        return 0
      }
      if (verb === 'github' && args[1] === 'pull') {
        printJson(
          await getGithubPullCli(
            rpc,
            argValueOrEq(argv, '--cwd') || args[3] || process.cwd(),
            args[2] || ''
          )
        )
        return 0
      }
      if (verb === 'github' && (args[1] === 'actions' || args[1] === 'runs')) {
        printJson(
          await listGithubActionsCli(
            rpc,
            args[2] || argValueOrEq(argv, '--cwd') || process.cwd(),
            argValueOrEq(argv, '--scope') || undefined
          )
        )
        return 0
      }
      if (verb === 'github' && args[1] === 'run') {
        printJson(
          await getGithubActionRunCli(
            rpc,
            argValueOrEq(argv, '--cwd') || args[3] || process.cwd(),
            args[2] || ''
          )
        )
        return 0
      }
      if (verb === 'github' && args[1] === 'releases') {
        printJson(
          await listGithubReleasesCli(rpc, args[2] || argValueOrEq(argv, '--cwd') || process.cwd())
        )
        return 0
      }
      if (verb === 'github' && (args[1] === 'pages' || args[1] === 'site')) {
        printJson(await getGithubSiteCli(rpc, args[2] || argValueOrEq(argv, '--cwd') || process.cwd()))
        return 0
      }
      if (verb === 'timers' && (args[1] === 'list' || !args[1])) {
        printJson(await listTimers(rpc))
        return 0
      }
      if (verb === 'timers' && args[1] === 'create') {
        printJson(await createTimer(rpc))
        return 0
      }
      if (verb === 'timers' && args[1] === 'add') {
        const patch = parseTimerPatch(argv)
        if (!patch.title || patch.prompt == null) {
          throw new Error('vav-board timers add --title TEXT --prompt TEXT [--cron EXPR|--every-ms N]')
        }
        printJson(await createTimerJob(rpc, { ...patch, title: patch.title, prompt: patch.prompt }))
        return 0
      }
      if (verb === 'timers' && args[1] === 'update') {
        const id = args[2]
        const patch = parseTimerPatch(argv)
        if (!id) throw new Error('vav-board timers update <id> [--title TEXT] [--prompt TEXT] [--enabled on|off]')
        printJson(await updateTimer(rpc, id, patch))
        return 0
      }
      if (verb === 'timers' && args[1] === 'get') {
        const id = args[2]
        if (!id) throw new Error('vav-board timers get <conversationId>')
        printJson(await getTimerForConversation(rpc, id))
        return 0
      }
      if (verb === 'timers' && args[1] === 'run') {
        const id = args[2]
        if (!id) throw new Error('vav-board timers run <id>')
        printJson(await runTimer(rpc, id))
        return 0
      }
      if (verb === 'timers' && (args[1] === 'remove' || args[1] === 'delete')) {
        const id = args[2]
        if (!id) throw new Error('vav-board timers remove <id>')
        printJson(await removeTimer(rpc, id))
        return 0
      }
      if (verb === 'timers' && args[1] === 'runs') {
        printJson(await listTimerRuns(rpc, args[2] || undefined))
        return 0
      }
      if (verb === 'timers' && args[1] === 'sessions') {
        printJson(await listTimerSessions(rpc))
        return 0
      }
      if (verb === 'connectors' && args[1] === 'login') {
        printJson(await beginConnectorLogin(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'connectors' && args[1] === 'cancel') {
        printJson(await cancelConnectorLoginCli(rpc, args[2] || undefined))
        return 0
      }
      if (verb === 'connectors' && args[1] === 'auth') {
        printJson(await connectorAuthStatus(rpc))
        return 0
      }
      if (verb === 'connectors' && args[1] === 'probe') {
        printJson(await probeConnectors(rpc, argValueOrEq(argv, '--cwd') || args[2] || ''))
        return 0
      }
      if (verb === 'connectors' && args[1] === 'status') {
        printJson(
          await connectorVendorStatus(rpc, args[2] || '', argValueOrEq(argv, '--cwd') || undefined)
        )
        return 0
      }
      if (verb === 'connectors' && args[1] === 'act') {
        const cwd = argValueOrEq(argv, '--cwd') || args[4] || process.cwd()
        printJson(await connectorAct(rpc, args[2] || '', args[3] || 'deploy', cwd))
        return 0
      }
      if (verb === 'connectors') {
        printJson(await listConnectors(rpc))
        return 0
      }
      if (verb === 'pane' && args[1] === 'run') {
        const command = args.slice(2).join(' ').trim()
        if (!command) throw new Error('vav-board pane run [--cwd PATH] -- <command>')
        printJson(
          await runPaneCommand(rpc, {
            cwd: argValueOrEq(argv, '--cwd'),
            file: argValueOrEq(argv, '--file') || argValueOrEq(argv, '--shell'),
            command,
            timeoutMs: Number(argValueOrEq(argv, '--timeout') || 4_000)
          })
        )
        return 0
      }
      if (verb === 'review' && args[1] === 'seed') {
        printJson(await seedReview(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'review' && args[1] === 'active') {
        printJson(await activeReview(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'review' && args[1] === 'get') {
        printJson(await getReview(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'review' && args[1] === 'accept-all') {
        printJson(await acceptAllReview(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'review' && args[1] === 'reject-all') {
        printJson(await rejectAllReview(rpc, args[2] || ''))
        return 0
      }
      if (verb === 'review' && args[1] === 'accept') {
        printJson(await acceptReview(rpc, args[2] || '', args.slice(3)))
        return 0
      }
      if (verb === 'review' && args[1] === 'reject') {
        printJson(await rejectReview(rpc, args[2] || '', args.slice(3)))
        return 0
      }
      if (verb === 'review' && args[1] === 'undo') {
        printJson(await undoReview(rpc, args[2] || '', args[3] || ''))
        return 0
      }
      throw new Error(`unknown command: ${verb}${args[1] ? ` ${args[1]}` : ''}`)
    })
  }

  if (verb === 'session' && args[1] === 'usage') {
    const id = args[2]
    if (!id) throw new Error('vav-board session usage <id>')
    const target = await resolveVavServerTarget({ argv })
    printJson(await withDaemon(target, (rpc) => getDaemonSession(rpc, id)))
    return 0
  }

  return withPhone(argv, 'vav-board', async (phone) => {
    if (verb === 'sessions' || (verb === 'session' && (args[1] === 'list' || !args[1]))) {
      printJson(await listSessions(phone))
      return 0
    }
    if (verb === 'create' || (verb === 'session' && args[1] === 'create') || (verb === 'workspace' && args[1] === 'create')) {
      const session = await ensureSession(phone, argv, undefined, true)
      printJson(session)
      return 0
    }
    if (verb === 'session' && args[1] === 'get') {
      const sessions = await listSessions(phone)
      printJson(resolveSession(sessions, args[2]))
      return 0
    }
    if (verb === 'session' && args[1] === 'attach') {
      const id = args[2] || argValueOrEq(argv, '--session')
      if (!id) throw new Error('vav-board session attach <id>')
      printJson(await fetchThread(phone, id))
      return 0
    }
    if (verb === 'session' && args[1] === 'stop') {
      const id = args[2]
      if (!id) throw new Error('vav-board session stop <id>')
      await cancelSession(phone, id)
      printJson({ ok: true, id })
      return 0
    }
    if (verb === 'session' && args[1] === 'delete') {
      const id = args[2]
      if (!id) throw new Error('vav-board session delete <id>')
      await archiveSession(phone, id)
      printJson({ ok: true, id })
      return 0
    }
    if (verb === 'session' && args[1] === 'rename') {
      const id = args[2]
      const title = args.slice(3).join(' ').trim()
      if (!id || !title) throw new Error('vav-board session rename <id> <title>')
      await renameSession(phone, id, title)
      printJson({ ok: true, id, title })
      return 0
    }
    if (verb === 'session' && args[1] === 'compact') {
      const id = args[2]
      if (!id) throw new Error('vav-board session compact <id>')
      printJson(await compactSession(phone, id, argValueOrEq(argv, '--keep-after') || undefined))
      return 0
    }
    if (verb === 'session' && args[1] === 'duplicate') {
      const id = args[2]
      if (!id) throw new Error('vav-board session duplicate <id>')
      printJson(await duplicateSession(phone, id))
      return 0
    }
    if (verb === 'session' && args[1] === 'continue') {
      const id = args[2]
      const messageId = args[3]
      if (!id || !messageId) throw new Error('vav-board session continue <id> <messageId>')
      printJson(await continueSession(phone, id, messageId))
      return 0
    }
    if (verb === 'session' && args[1] === 'regenerate') {
      const id = args[2]
      const messageId = args[3]
      if (!id || !messageId) throw new Error('vav-board session regenerate <id> <messageId>')
      printJson(await regenerateSession(phone, id, messageId))
      return 0
    }
    if (verb === 'session' && args[1] === 'edit') {
      const id = args[2]
      const messageId = args[3]
      const text = args.slice(4).join(' ').trim()
      if (!id || !messageId || !text) throw new Error('vav-board session edit <id> <messageId> <text>')
      printJson(await editSession(phone, id, messageId, text))
      return 0
    }
    if (verb === 'session' && args[1] === 'fork') {
      const id = args[2]
      const messageId = args[3]
      if (!id || !messageId) throw new Error('vav-board session fork <id> <messageId>')
      await forkSession(phone, id, messageId)
      printJson({ ok: true, id, messageId })
      return 0
    }
    if (verb === 'session' && args[1] === 'goal') {
      const id = args[2]
      const action = args[3]
      const objective = args.slice(4).join(' ').trim()
      if (!id || (action !== 'set' && action !== 'pause' && action !== 'resume' && action !== 'clear')) {
        throw new Error('vav-board session goal <id> <set|pause|resume|clear> [objective]')
      }
      printJson(await applyGoal(phone, id, action, objective || undefined))
      return 0
    }
    if (verb === 'session' && args[1] === 'locate') {
      const id = args[2]
      const dir = args.slice(3).join(' ').trim()
      if (!id || !dir) throw new Error('vav-board session locate <id> <dir>')
      printJson(await locateWorkspace(phone, id, dir))
      return 0
    }
    if (verb === 'session' && args[1] === 'delete-message') {
      const id = args[2]
      const messageId = args[3]
      if (!id || !messageId) throw new Error('vav-board session delete-message <id> <messageId>')
      await deleteMessage(phone, id, messageId)
      printJson({ ok: true, id, messageId })
      return 0
    }
    if (verb === 'session' && args[1] === 'leaf') {
      const id = args[2]
      const messageId = args[3]
      if (!id || !messageId) throw new Error('vav-board session leaf <id> <messageId>')
      await setLeaf(phone, id, messageId)
      printJson({ ok: true, id, messageId })
      return 0
    }
    if (verb === 'session' && (args[1] === 'pin' || args[1] === 'unpin')) {
      const id = args[2]
      if (!id) throw new Error(`vav-board session ${args[1]} <id>`)
      await pinSession(phone, id, args[1] === 'pin')
      printJson({ ok: true, id, pinned: args[1] === 'pin' })
      return 0
    }
    if (verb === 'session' && (args[1] === 'star' || args[1] === 'unstar')) {
      const id = args[2]
      if (!id) throw new Error(`vav-board session ${args[1]} <id>`)
      await favoriteSession(phone, id, args[1] === 'star')
      printJson({ ok: true, id, favorite: args[1] === 'star' })
      return 0
    }
    if (verb === 'session' && args[1] === 'reply') {
      const id = args[2]
      const toolCallId = args[3]
      const answer = args.slice(4).join(' ').trim()
      if (!id || !toolCallId || !answer) throw new Error('vav-board session reply <id> <toolCallId> <answer>')
      await replySession(phone, id, toolCallId, answer)
      printJson({ ok: true, id, toolCallId })
      return 0
    }
    if (verb === 'workspace' && args[1] === 'list') {
      const sessions = await listSessions(phone)
      printJson(
        sessions.map((row) => ({
          id: row.id,
          title: row.title,
          workdir: row.workdir,
          dirLabel: row.dirLabel,
          temporary: row.temporary,
          status: row.status
        }))
      )
      return 0
    }
    if (verb === 'workspace' && args[1] === 'recents') {
      const target = await resolveVavServerTarget({ argv })
      printJson(await withDaemon(target, (rpc) => listRecentWorkspaces(rpc)))
      return 0
    }
    if (verb === 'workspace' && args[1] === 'browse') {
      const id = args[2]
      if (!id) throw new Error('vav-board workspace browse <id> [path]')
      printJson(
        await browseWorkspace(
          phone,
          id,
          args[3] || argValueOrEq(argv, '--path'),
          argv.includes('--files')
        )
      )
      return 0
    }
    if (verb === 'workspace' && args[1] === 'get') {
      const sessions = await listSessions(phone)
      const row = resolveSession(sessions, args[2])
      printJson(row)
      return 0
    }
    if (verb === 'workspace' && args[1] === 'focus') {
      const id = args[2]
      if (!id) throw new Error('vav-board workspace focus <id>')
      const cwd = argValueOrEq(argv, '--cwd')
      if (cwd) await setWorkspace(phone, id, cwd)
      printJson(await fetchControls(phone, id))
      return 0
    }
    if (verb === 'workspace' && args[1] === 'close') {
      const id = args[2]
      if (!id) throw new Error('vav-board workspace close <id>')
      await archiveSession(phone, id)
      printJson({ ok: true, id })
      return 0
    }
    if (verb === 'agent' && (args[1] === 'list' || !args[1])) {
      const sessions = await listSessions(phone)
      printJson(
        sessions.map((row) => ({
          name: row.id,
          title: row.title,
          kind: row.surface,
          status: row.status === 'running' ? 'working' : row.status === 'done' ? 'done' : 'idle',
          workdir: row.workdir,
          pane: row.id
        }))
      )
      return 0
    }
    if (verb === 'agent' && args[1] === 'get') {
      const sessions = await listSessions(phone)
      const row = resolveSession(sessions, args[2])
      if (!row) throw new Error('vav-board agent get <id>')
      printJson({ ...row, kind: row.surface, status: row.status === 'running' ? 'working' : row.status })
      return 0
    }
    if (verb === 'agent' && args[1] === 'start') {
      const kind = argValueOrEq(argv, '--kind') || 'vav'
      if (kind !== 'vav') throw new Error('vav-server hosts the VAV agent; use --kind vav (other CLIs run in the app terminal)')
      const session = await ensureSession(phone, argv, undefined, true)
      printJson({ name: session.id, kind: 'vav', session })
      return 0
    }
    if (verb === 'agent' && args[1] === 'prompt') {
      const id = args[2] || argValueOrEq(argv, '--session')
      const text = args.slice(id && args[2] === id ? 3 : 2).join(' ').trim()
      if (!id || !text) throw new Error('vav-board agent prompt <id> <text>')
      if (argv.includes('--wait')) {
        const turn = await sendTurn(phone, id, text)
        printJson({ session: id, turn })
      } else {
        phone.send({ type: 'send', conversationId: id, text })
        await phone.waitNew((msg) => msg.type === 'sent' || (msg.type === 'turn' && msg.conversationId === id), 8000)
        printJson({ session: id, queued: true })
      }
      return 0
    }
    if (verb === 'agent' && args[1] === 'wait') {
      const id = args[2] || argValueOrEq(argv, '--session')
      if (!id) throw new Error('vav-board agent wait <id>')
      const untilRaw = argValueOrEq(argv, '--until')
      const until = untilRaw
        ? (untilRaw.split(',').map((item) => (item === 'working' ? 'running' : item)) as Array<'idle' | 'done' | 'running'>)
        : (['idle', 'done'] as const)
      const timeout = Number(argValueOrEq(argv, '--timeout') || 120_000)
      printJson(await waitSessionStatus(phone, id, [...until], timeout))
      return 0
    }
    if (verb === 'send') {
      const text = args.slice(1).join(' ').trim()
      if (!text) throw new Error('vav-board send <text>')
      const id = argValueOrEq(argv, '--session')
      const session = await ensureSession(phone, argv, id, !id)
      const turn = await sendTurn(phone, session.id, text)
      printJson({ session: session.id, turn })
      return 0
    }
    if (verb === 'thread') {
      const id = argValueOrEq(argv, '--session')
      if (!id) throw new Error('vav-board thread --session <id>')
      printJson(await fetchThread(phone, id))
      return 0
    }
    if (verb === 'configure') {
      const id = argValueOrEq(argv, '--session')
      if (!id) throw new Error('vav-board configure --session <id>')
      printJson(
        await configureSession(phone, id, {
          model: argValueOrEq(argv, '--model'),
          approval: argValueOrEq(argv, '--approval'),
          thinking: argValueOrEq(argv, '--thinking'),
          agent: argValueOrEq(argv, '--agent'),
          mode: argValueOrEq(argv, '--mode')
        })
      )
      return 0
    }
    throw new Error(`unknown command: ${verb}${args[1] ? ` ${args[1]}` : ''}`)
  })
}

const entry = process.argv[1] || ''
if (/(?:^|[\\/])vav-board\.(ts|js)$/.test(entry)) {
  void runVavBoard().then((code) => {
    if (code) process.exit(code)
  }, (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
    process.exit(1)
  })
}
