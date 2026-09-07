#!/usr/bin/env node
/**
 * vavcli — pi-style agent CLI against a running vavd.
 *
 * Modes: interactive (TTY), print (`-p`), JSON event stream (`--mode json`),
 * and a small stdin RPC (`--mode rpc`). Turns run in vavd; the desktop app
 * sees the same session.
 */
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdin as input, stdout as output } from 'node:process'
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
  listSessions,
  locateWorkspace,
  pinSession,
  printLine,
  regenerateSession,
  renameSession,
  replySession,
  resolveSession,
  setLeaf,
  setWorkspace
} from '@main/cli/vavControl.ts'
import {
  acceptAllReview,
  acceptReview,
  activeReview,
  getDaemonSession,
  getHostSettings,
  getReview,
  gitDiff,
  gitInit,
  gitCreateBranch,
  gitCheckoutBranch,
  gitCreateWorktree,
  gitShowBase64,
  gitStatus,
  beginAccountOAuth,
  cancelAccountOAuth,
  connectorAuthStatus,
  connectorVendorStatus,
  draftAccount,
  updateAccount,
  setCurrentAccount,
  activateAccount,
  verifyAccount,
  revealAccountKey,
  listAccounts,
  getGithubActionRunCli,
  getGithubPullCli,
  getGithubSiteCli,
  listConnectors,
  listGithubActionsCli,
  listGithubPulls,
  listGithubReleasesCli,
  probeConnectors,
  createPlugin,
  listPlugins,
  setPluginEnabled,
  logsStats,
  clearLogs,
  exportLogs,
  recordLog,
  tailLogs,
  createFileSession,
  renameFileSession,
  deleteFileSessions,
  activateFileSession,
  forceDeleteFileSessions,
  setFileSessionReadOnly,
  listFileSessions,
  openFileSession,
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
  rejectAllReview,
  rejectReview,
  removeAccount,
  signOutAccount,
  seedReview,
  undoReview,
  updateHostSettings,
  setHostSecret,
  hintHostSecret,
  revealHostSecret,
  withDaemon,
  writeFileText,
  mkdirFile,
  renameFile,
  unlinkFile,
  existsFile
} from '@main/cli/vavDaemonCli.ts'
import { connectPhoneTarget, type PhoneClient } from '@main/cli/vavPhoneClient.ts'
import { runVavcliLines, runVavcliRpc, streamTurn } from './vavcliSession.ts'
import {
  TARGET_FLAGS,
  argValueOrEq,
  positionalArgs,
  resolveVavdTarget,
  type VavdTarget
} from '@main/cli/vavdTarget.ts'

export { runVavcliLines, runVavcliRpc, streamTurn } from './vavcliSession.ts'

const CLI_FLAGS = new Set([
  ...TARGET_FLAGS,
  '--cwd',
  '--workdir',
  '--session',
  '--model',
  '-m',
  '--thinking',
  '--approval',
  '--mode',
  '-p',
  '--print',
  '--event',
  '--message',
  '--alias',
  '--key',
  '--name',
  '--set',
  '--count',
  '--timeout'
])

export function vavcliHelp(): string {
  return [
    'vav-cli — VAV agent in the terminal (Claude Code-style)',
    '',
    '  vavcli / vav-cli               interactive REPL against a vavd session',
    '  vavcli /files                  one-shot slash command (no TTY required)',
    '  vavcli -p "query"              print mode — stream the turn, then exit',
    '  vavcli --mode json -p "query"  NDJSON turn events',
    '  vavcli --mode rpc              JSON lines on stdin (prompt / cancel / quit)',
    '  vavcli -c                      continue the last session',
    '  vavcli --session <id>          attach a known session',
    '',
    'Interactive slash commands: /help /new /session /thread /status /export /cost',
    '  /model /cwd /approval /permissions /thinking /run-mode /files /file /git /diff /github /timers /init /compact',
    '  /duplicate /pin /unpin /star /archive /stop /rename /regenerate /fork /reply /edit /continue /goal /locate /leaf /delete',
    '  /review /account oauth /settings /plugins [list|create <kind> <name>|enable|disable] /connectors /logs /file-session /quit',
    '',
    '  -p, --print            one-shot (streams draft, waits for done/error)',
    '  --mode text|json|rpc   output / control mode (default text)',
    '  -c, --continue         last updated session',
    '  --session <id>         existing session id',
    '  --cwd, --workdir PATH  set the session workdir before sending',
    '  -m, --model ID         configure model',
    '  --thinking off|low|medium|high',
    '  --approval auto|bypass|edit',
    '  --uri / --host / --port / --secret / --state',
    '  --version, -h',
    ''
  ].join('\n')
}

function modeOf(argv: string[]): 'text' | 'json' | 'rpc' {
  const raw = argValueOrEq(argv, '--mode') || 'text'
  if (raw === 'json' || raw === 'rpc' || raw === 'text') return raw
  throw new Error(' --mode must be text, json, or rpc')
}

const SLASH_COMMANDS = new Set([
  'help',
  'h',
  'new',
  'session',
  'thread',
  'status',
  'export',
  'cost',
  'model',
  'cwd',
  'approval',
  'permissions',
  'thinking',
  'run-mode',
  'files',
  'file',
  'file-session',
  'git',
  'diff',
  'github',
  'timers',
  'init',
  'compact',
  'duplicate',
  'pin',
  'unpin',
  'star',
  'unstar',
  'favorite',
  'unfavorite',
  'archive',
  'stop',
  'cancel',
  'plugins',
  'connectors',
  'logs',
  'rename',
  'regenerate',
  'fork',
  'reply',
  'edit',
  'continue',
  'goal',
  'locate',
  'leaf',
  'delete',
  'review',
  'account',
  'settings',
  'quit',
  'exit'
])

function isSlashCommand(arg: string): boolean {
  if (!arg.startsWith('/')) return false
  return SLASH_COMMANDS.has(arg.slice(1).split(/\s+/)[0] || '')
}

/** `-p` is always a turn. Bare `/files` (and friends) are slash commands. */
export function vavcliArgvIntent(argv: string[]): { slashes: string[]; prompt: string } {
  const eq = argv.find((arg) => arg.startsWith('--print='))
  const flagged = eq ? eq.slice('--print='.length) : argValueOrEq(argv, '-p') || argValueOrEq(argv, '--print')
  const rest = positionalArgs(argv, CLI_FLAGS)
  if (flagged) return { slashes: [], prompt: [flagged, ...rest].filter(Boolean).join(' ').trim() }
  const slashes: string[] = []
  const words: string[] = []
  for (const arg of rest) {
    if (isSlashCommand(arg)) slashes.push(arg)
    else if (slashes.length) slashes[slashes.length - 1] += ` ${arg}`
    else words.push(arg)
  }
  return { slashes, prompt: words.join(' ').trim() }
}

function packageVersion(): string {
  try {
    const here = typeof import.meta.dirname === 'string' ? import.meta.dirname : dirname(fileURLToPath(import.meta.url))
    for (const file of [join(here, '../../../package.json'), join(process.cwd(), 'package.json')]) {
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

async function prepareSession(phone: PhoneClient, argv: string[]): Promise<string> {
  const sessions = await listSessions(phone)
  const wantContinue = argv.includes('-c') || argv.includes('--continue')
  const id = argValueOrEq(argv, '--session')
  let session = resolveSession(sessions, id, wantContinue ? 'last' : 'none')
  if (!session) session = await createSession(phone)
  const cwd = argValueOrEq(argv, '--cwd') || argValueOrEq(argv, '--workdir')
  const model = argValueOrEq(argv, '-m') || argValueOrEq(argv, '--model')
  const thinking = argValueOrEq(argv, '--thinking')
  const approval = argValueOrEq(argv, '--approval')
  if (cwd) await setWorkspace(phone, session.id, cwd)
  if (model || thinking || approval) {
    await configureSession(phone, session.id, { model, thinking, approval })
  }
  return session.id
}

async function* stdinLines(): AsyncGenerator<string> {
  let buf = ''
  for await (const chunk of input) {
    buf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    let idx = buf.indexOf('\n')
    while (idx >= 0) {
      yield buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      idx = buf.indexOf('\n')
    }
  }
  if (buf.trim()) yield buf
}

async function runRpc(phone: PhoneClient, session: string, mode: 'text' | 'json'): Promise<number> {
  return runVavcliRpc(phone, session, stdinLines(), mode)
}

const SLASH_HELP = [
  '/help              this list',
  '/new               start another session',
  '/session           print the current session id',
  '/thread            print the transcript',
  '/model [id]        show or set the model',
  '/cwd [path]        show or set the workdir',
  '/approval [mode]   show or set auto|bypass|edit',
  '/permissions [mode]  alias of /approval',
  '/thinking [level]  show or set off|low|medium|high',
  '/run-mode [id]     show or set ACP session mode (agent|plan|…)',
  '/status            session + run bar + workdir files',
  '/export            dump the transcript JSON',
  '/cost              tokens from the host session row',
  '/init              write AGENTS.md in the session workdir',
  '/compact           fold earlier turns on the host (same as desktop Compact)',
  '/duplicate         deep-copy this session (same as desktop Duplicate)',
  '/pin /unpin        pin or unpin this session',
  '/star /unstar      favorite or unfavorite this session',
  '/archive           archive this session (same as desktop Delete)',
  '/stop              cancel the running turn',
  '/rename <title>    rename this session',
  '/regenerate        rerun the last assistant turn',
  '/fork              fork at the last assistant message',
  '/reply <id> <ans>  answer a parked Approve / Ask (same as desktop)',
  '/edit [id] <text>  edit the last user turn (or id) and rerun',
  '/continue [id]     continue from the last assistant turn in a new session',
  '/goal [text|pause|resume|clear]  set or control the session goal',
  '/locate <dir>      move a Temporary Workspace onto a durable folder',
  '/leaf              sit the active leaf on the last message',
  '/delete            delete the last message and its descendants',
  '/files [path]      browse the session workdir',
  '/file [mkdir|rename|rm|exists]  host file I/O on this vavd (same fs.* as Chrome Files)',
  '/review [seed|active|get <setId>|accept-all <setId>|reject-all <setId>|accept <setId> [path…]|reject <setId> [path…]|undo <setId> <path>]',
  '/git [status|init|branch|checkout|worktree|show] [cwd]  dirty files, or git verbs on a folder',
  '/diff <path>       unstaged diff for a path on the session workdir',
  '/github [pulls|pull <n>|actions|run <id>|releases|pages]  GitHub panel for the session workdir',
  '/timers [list|create|add|get <id>|update <id>|run <id>|remove <id>|runs [id]|sessions]  scheduled jobs on this vavd',
  '/plugins [list|create <kind> <name>|enable <id>|disable <id>]  skills / MCP / hooks on this vavd',
  '/connectors [list|auth|probe|status <cloudflare|supabase|vercel>|act <id> <action>]  vendor catalog / signed-in / project status / deploy',
  '/logs [query|stats|clear [scope]|export|record|tail]  diagnostic rows on this vavd',
  '/file-session [open|create|list|activate|rename|delete|force-delete|readonly]  file-preview conversations on this vavd',
  '/account [list|draft|remove|update|current|activate|verify|reveal|oauth <agent>|cancel <agent>|signout <agent>]  provider keys on this vavd',
  '/settings [get|set --model ID --approval MODE --thinking LEVEL|secret|hint|reveal-secret]  host prefs on this vavd',
  '/quit              exit'
].join('\n')

async function handleSlash(
  phone: PhoneClient,
  session: string,
  line: string,
  target?: VavdTarget,
  argv: string[] = []
): Promise<string | 'quit' | null> {
  const [cmd, ...rest] = line.slice(1).split(/\s+/)
  const arg = rest.join(' ').trim()
  if (cmd === 'quit' || cmd === 'exit') return 'quit'
  if (cmd === 'help' || cmd === 'h') {
    printLine(SLASH_HELP)
    return session
  }
  if (cmd === 'new') {
    const next = (await createSession(phone)).id
    printLine(`session ${next}`)
    return next
  }
  if (cmd === 'session') {
    printLine(session)
    return session
  }
  if (cmd === 'thread') {
    printJsonish(await fetchThread(phone, session))
    return session
  }
  if (cmd === 'status') {
    const [row, controls, files] = await Promise.all([
      listSessions(phone).then((rows) => resolveSession(rows, session)),
      fetchControls(phone, session),
      browseWorkspace(phone, session, arg || undefined, true).catch((err: Error) => ({
        error: err.message
      }))
    ])
    printJsonish({ session: row, controls, files })
    return session
  }
  if (cmd === 'export') {
    printJsonish({
      session: resolveSession(await listSessions(phone), session),
      thread: await fetchThread(phone, session)
    })
    return session
  }
  if (
    cmd === 'model' ||
    cmd === 'cwd' ||
    cmd === 'approval' ||
    cmd === 'permissions' ||
    cmd === 'thinking' ||
    cmd === 'run-mode'
  ) {
    if (arg) {
      if (cmd === 'cwd') await setWorkspace(phone, session, arg)
      else if (cmd === 'model') await configureSession(phone, session, { model: arg })
      else if (cmd === 'approval' || cmd === 'permissions') {
        await configureSession(phone, session, { approval: arg })
      } else if (cmd === 'run-mode') await configureSession(phone, session, { mode: arg })
      else await configureSession(phone, session, { thinking: arg })
    }
    printJsonish(await fetchControls(phone, session))
    return session
  }
  if (cmd === 'cost') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /cost needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const row = await withDaemon(target, (rpc) => getDaemonSession(rpc, session))
    const conversation = (row as { conversation?: { tokensUsed?: number; tokenLimit?: number; title?: string } })
      .conversation
    printJsonish({
      session,
      title: conversation?.title ?? null,
      tokensUsed: conversation?.tokensUsed ?? 0,
      tokenLimit: conversation?.tokenLimit ?? 0
    })
    return session
  }
  if (cmd === 'init') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /init needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const controls = await fetchControls(phone, session)
    const cwd =
      controls && controls.type === 'controls' && typeof controls.workingDirectory === 'string'
        ? controls.workingDirectory
        : ''
    if (!cwd) {
      process.stderr.write('vavcli /init: session has no workdir\n')
      return session
    }
    const path = cwd.endsWith('/') ? `${cwd}AGENTS.md` : `${cwd}/AGENTS.md`
    const body = [
      '# Agent notes',
      '',
      'Written by `vav-cli /init`. The desktop, Chrome, and phone clients share this workdir.',
      ''
    ].join('\n')
    await withDaemon(target, (rpc) => writeFileText(rpc, path, body))
    printLine(path)
    return session
  }
  if (cmd === 'compact') {
    printJsonish(await compactSession(phone, session, arg || undefined))
    return session
  }
  if (cmd === 'duplicate') {
    const next = await duplicateSession(phone, session)
    printLine(`session ${next.id}`)
    return next.id
  }
  if (cmd === 'pin' || cmd === 'unpin') {
    await pinSession(phone, session, cmd === 'pin')
    printLine(cmd === 'pin' ? 'pinned' : 'unpinned')
    return session
  }
  if (cmd === 'star' || cmd === 'favorite' || cmd === 'unstar' || cmd === 'unfavorite') {
    const on = cmd === 'star' || cmd === 'favorite'
    await favoriteSession(phone, session, on)
    printLine(on ? 'starred' : 'unstarred')
    return session
  }
  if (cmd === 'archive') {
    await archiveSession(phone, session)
    printLine('archived')
    return session
  }
  if (cmd === 'stop' || cmd === 'cancel') {
    await cancelSession(phone, session)
    printLine('stopped')
    return session
  }
  if (cmd === 'rename') {
    if (!arg) {
      process.stderr.write('vavcli /rename <title>\n')
      return session
    }
    await renameSession(phone, session, arg)
    printLine(arg)
    return session
  }
  if (cmd === 'regenerate' || cmd === 'fork') {
    const thread = await fetchThread(phone, session)
    const messages = thread && thread.type === 'thread' ? thread.messages : []
    const target =
      (arg && messages.find((row) => row.id === arg)) ||
      [...messages].reverse().find((row) => row.role === 'assistant')
    if (!target?.id) {
      process.stderr.write(`vavcli /${cmd}: no assistant message\n`)
      return session
    }
    if (cmd === 'fork') {
      await forkSession(phone, session, target.id)
      printLine(`forked ${target.id}`)
      return session
    }
    printJsonish(await regenerateSession(phone, session, target.id))
    return session
  }
  if (cmd === 'reply') {
    const toolCallId = rest[0] || ''
    const answer = rest.slice(1).join(' ').trim()
    if (!toolCallId || !answer) {
      process.stderr.write('vavcli /reply <toolCallId> <answer>\n')
      return session
    }
    await replySession(phone, session, toolCallId, answer)
    printLine(`replied ${toolCallId}`)
    return session
  }
  if (cmd === 'edit') {
    const thread = await fetchThread(phone, session)
    const messages = thread && thread.type === 'thread' ? thread.messages : []
    const byId = arg ? messages.find((row) => row.id === rest[0]) : undefined
    const text = byId ? rest.slice(1).join(' ').trim() : arg
    const target = byId || [...messages].reverse().find((row) => row.role === 'user')
    if (!target?.id || !text) {
      process.stderr.write('vavcli /edit [messageId] <text>\n')
      return session
    }
    printJsonish(await editSession(phone, session, target.id, text))
    return session
  }
  if (cmd === 'continue') {
    const thread = await fetchThread(phone, session)
    const messages = thread && thread.type === 'thread' ? thread.messages : []
    const target =
      (arg && messages.find((row) => row.id === arg)) ||
      [...messages].reverse().find((row) => row.role === 'assistant')
    if (!target?.id) {
      process.stderr.write('vavcli /continue: no assistant message\n')
      return session
    }
    const next = await continueSession(phone, session, target.id)
    printLine(`session ${next.id}`)
    return next.id
  }
  if (cmd === 'goal') {
    const token = arg.split(/\s+/)[0] || ''
    if (token === 'pause' || token === 'resume' || token === 'clear') {
      printJsonish(await applyGoal(phone, session, token))
      return session
    }
    if (!arg) {
      process.stderr.write('vavcli /goal <objective>|pause|resume|clear\n')
      return session
    }
    printJsonish(await applyGoal(phone, session, 'set', arg))
    return session
  }
  if (cmd === 'locate') {
    if (!arg) {
      process.stderr.write('vavcli /locate <dir>\n')
      return session
    }
    printJsonish(await locateWorkspace(phone, session, arg))
    return session
  }
  if (cmd === 'leaf' || cmd === 'delete') {
    const thread = await fetchThread(phone, session)
    const messages = thread && thread.type === 'thread' ? thread.messages : []
    const target =
      (arg && messages.find((row) => row.id === arg)) || messages[messages.length - 1]
    if (!target?.id) {
      process.stderr.write(`vavcli /${cmd}: no message\n`)
      return session
    }
    if (cmd === 'leaf') {
      await setLeaf(phone, session, target.id)
      printLine(`leaf ${target.id}`)
      return session
    }
    await deleteMessage(phone, session, target.id)
    printLine(`deleted ${target.id}`)
    return session
  }
  if (cmd === 'file') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /file needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || ''
    if (sub === 'mkdir') {
      const path = tokens.slice(1).join(' ').trim()
      if (!path) {
        process.stderr.write('vavcli /file mkdir <path>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => mkdirFile(rpc, path)))
      return session
    }
    if (sub === 'rename') {
      if (!tokens[1] || !tokens[2]) {
        process.stderr.write('vavcli /file rename <from> <to>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => renameFile(rpc, tokens[1], tokens[2])))
      return session
    }
    if (sub === 'rm' || sub === 'unlink' || sub === 'delete') {
      const path = tokens.slice(1).join(' ').trim()
      if (!path) {
        process.stderr.write('vavcli /file rm <path>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => unlinkFile(rpc, path)))
      return session
    }
    if (sub === 'exists') {
      const path = tokens.slice(1).join(' ').trim()
      if (!path) {
        process.stderr.write('vavcli /file exists <path>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => existsFile(rpc, path)))
      return session
    }
    process.stderr.write('vavcli /file [mkdir|rename|rm|exists]\n')
    return session
  }
  if (cmd === 'files') {
    printJsonish(await browseWorkspace(phone, session, arg || undefined, true))
    return session
  }
  if (cmd === 'review') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /review needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || 'active'
    if (sub === 'active' || sub === 'seed') {
      printJsonish(
        await withDaemon(target, (rpc) =>
          sub === 'seed' ? seedReview(rpc, session) : activeReview(rpc, session)
        )
      )
      return session
    }
    if (sub === 'get') {
      printJsonish(await withDaemon(target, (rpc) => getReview(rpc, tokens[1] || '')))
      return session
    }
    if (sub === 'accept-all') {
      printJsonish(await withDaemon(target, (rpc) => acceptAllReview(rpc, tokens[1] || '')))
      return session
    }
    if (sub === 'reject-all') {
      printJsonish(await withDaemon(target, (rpc) => rejectAllReview(rpc, tokens[1] || '')))
      return session
    }
    if (sub === 'accept') {
      printJsonish(await withDaemon(target, (rpc) => acceptReview(rpc, tokens[1] || '', tokens.slice(2))))
      return session
    }
    if (sub === 'reject') {
      printJsonish(await withDaemon(target, (rpc) => rejectReview(rpc, tokens[1] || '', tokens.slice(2))))
      return session
    }
    if (sub === 'undo') {
      printJsonish(await withDaemon(target, (rpc) => undoReview(rpc, tokens[1] || '', tokens[2] || '')))
      return session
    }
    process.stderr.write(
      'vavcli /review [seed|active|get <setId>|accept-all <setId>|reject-all <setId>|accept <setId> [path…]|reject <setId> [path…]|undo <setId> <path>]\n'
    )
    return session
  }
  if (cmd === 'git') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /git needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const gitSubs = new Set(['init', 'status', 'branch', 'checkout', 'worktree', 'show'])
    const sub = gitSubs.has(tokens[0] || '') ? tokens[0]! : 'status'
    const rest = sub === tokens[0] ? tokens.slice(1) : tokens
    const controls = await fetchControls(phone, session)
    const sessionCwd =
      controls && controls.type === 'controls' && typeof controls.workingDirectory === 'string'
        ? controls.workingDirectory
        : ''
    const cwd =
      argValueOrEq(argv, '--cwd') ||
      (sub === 'init' || sub === 'status' ? rest.join(' ').trim() : '') ||
      sessionCwd ||
      ''
    if (!cwd) {
      process.stderr.write('vavcli /git: session has no workdir\n')
      return session
    }
    if (sub === 'init') {
      printJsonish(await withDaemon(target, (rpc) => gitInit(rpc, cwd)))
      return session
    }
    if (sub === 'branch') {
      const name = rest[0] || ''
      if (!name) {
        process.stderr.write('vavcli /git branch <name> [--cwd PATH] [--checkout]\n')
        return session
      }
      printJsonish(
        await withDaemon(target, (rpc) => gitCreateBranch(rpc, cwd, name, argv.includes('--checkout')))
      )
      return session
    }
    if (sub === 'checkout') {
      const name = rest[0] || ''
      if (!name) {
        process.stderr.write('vavcli /git checkout <name> [--cwd PATH]\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => gitCheckoutBranch(rpc, cwd, name)))
      return session
    }
    if (sub === 'worktree') {
      const path = rest[0] || ''
      if (!path) {
        process.stderr.write('vavcli /git worktree <path> [--new-branch NAME] [--cwd PATH]\n')
        return session
      }
      printJsonish(
        await withDaemon(target, (rpc) =>
          gitCreateWorktree(rpc, cwd, path, {
            newBranch: argValueOrEq(argv, '--new-branch') || argValueOrEq(argv, '--newBranch'),
            branch: argValueOrEq(argv, '--branch')
          })
        )
      )
      return session
    }
    if (sub === 'show') {
      const path = rest[0] || ''
      if (!path) {
        process.stderr.write('vavcli /git show <path> [--ref REF] [--cwd PATH]\n')
        return session
      }
      printJsonish(
        await withDaemon(target, (rpc) =>
          gitShowBase64(rpc, cwd, path, argValueOrEq(argv, '--ref') || 'HEAD')
        )
      )
      return session
    }
    printJsonish(await withDaemon(target, (rpc) => gitStatus(rpc, cwd)))
    return session
  }
  if (cmd === 'plugins') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /plugins needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || 'list'
    if (sub === 'create') {
      printJsonish(await withDaemon(target, (rpc) => createPlugin(rpc, tokens[1] || '', tokens.slice(2).join(' '))))
      return session
    }
    if (sub === 'enable' || sub === 'disable') {
      printJsonish(
        await withDaemon(target, (rpc) => setPluginEnabled(rpc, 'vav', tokens[1] || '', sub === 'enable'))
      )
      return session
    }
    const host = sub === 'list' ? tokens[1] || 'vav' : sub
    printJsonish(await withDaemon(target, (rpc) => listPlugins(rpc, host)))
    return session
  }
  if (cmd === 'connectors') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /connectors needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const [sub, vendor] = tokens
    if (!sub || sub === 'list') {
      printJsonish(await withDaemon(target, (rpc) => listConnectors(rpc)))
      return session
    }
    if (sub === 'auth') {
      printJsonish(await withDaemon(target, (rpc) => connectorAuthStatus(rpc)))
      return session
    }
    if (sub === 'probe') {
      printJsonish(await withDaemon(target, (rpc) => probeConnectors(rpc, vendor || '')))
      return session
    }
    if (sub === 'status') {
      if (!vendor) {
        process.stderr.write('vavcli /connectors status <cloudflare|supabase|vercel>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => connectorVendorStatus(rpc, vendor)))
      return session
    }
    if (sub === 'act') {
      const controls = await fetchControls(phone, session)
      const cwd =
        tokens.includes('--cwd')
          ? tokens[tokens.indexOf('--cwd') + 1] || ''
          : (controls && controls.type === 'controls' && typeof controls.workingDirectory === 'string'
              ? controls.workingDirectory
              : '') || ''
      const action = tokens[2] || 'deploy'
      if (!vendor || !cwd) {
        process.stderr.write('vavcli /connectors act <id> <action> [--cwd PATH]\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => connectorAct(rpc, vendor, action, cwd)))
      return session
    }
    process.stderr.write('vavcli /connectors [list|auth|probe|status <cloudflare|supabase|vercel>|act <id> <action>]\n')
    return session
  }
  if (cmd === 'logs') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /logs needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || 'query'
    if (sub === 'stats') {
      printJsonish(await withDaemon(target, (rpc) => logsStats(rpc)))
      return session
    }
    if (sub === 'clear') {
      printJsonish(await withDaemon(target, (rpc) => clearLogs(rpc, tokens[1] || 'all')))
      return session
    }
    if (sub === 'export') {
      printJsonish(await withDaemon(target, (rpc) => exportLogs(rpc)))
      return session
    }
    if (sub === 'record') {
      const flags = [...argv, ...tokens]
      const event = argValueOrEq(flags, '--event') || tokens[1] || ''
      const message = argValueOrEq(flags, '--message') || tokens.slice(event === tokens[1] ? 2 : 1).join(' ').trim()
      if (!event || !message) {
        process.stderr.write('vavcli /logs record --event NAME --message TEXT\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => recordLog(rpc, { event, message, conversationId: session })))
      return session
    }
    if (sub === 'tail') {
      const flags = [...argv, ...tokens]
      printJsonish(
        await withDaemon(target, (rpc) =>
          tailLogs(rpc, {
            count: Number(argValueOrEq(flags, '--count') || 0) || undefined,
            timeoutMs: Number(argValueOrEq(flags, '--timeout') || 0) || undefined,
            event: argValueOrEq(flags, '--event'),
            message: argValueOrEq(flags, '--message'),
            conversationId: session
          })
        )
      )
      return session
    }
    const raw = sub === 'query' ? tokens.slice(1).join(' ').trim() : arg.trim()
    const query = raw
      ? raw.startsWith('{')
        ? (JSON.parse(raw) as Record<string, unknown>)
        : { limit: Number(raw) || 20 }
      : { limit: 20 }
    printJsonish(await withDaemon(target, (rpc) => queryLogs(rpc, query)))
    return session
  }
  if (cmd === 'file-session') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /file-session needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || 'list'
    if (sub === 'open') {
      const path = tokens.slice(1).join(' ').trim()
      if (!path) {
        process.stderr.write('vavcli /file-session open <path>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => openFileSession(rpc, path)))
      return session
    }
    if (sub === 'create') {
      const path = tokens.slice(1).join(' ').trim()
      if (!path) {
        process.stderr.write('vavcli /file-session create <path>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => createFileSession(rpc, path)))
      return session
    }
    if (sub === 'rename') {
      const title = tokens.slice(3).join(' ').trim()
      if (!tokens[1] || !tokens[2] || !title) {
        process.stderr.write('vavcli /file-session rename <fileId> <sessionId> <title>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => renameFileSession(rpc, tokens[1], tokens[2], title)))
      return session
    }
    if (sub === 'activate') {
      if (!tokens[1] || !tokens[2]) {
        process.stderr.write('vavcli /file-session activate <fileId> <sessionId>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => activateFileSession(rpc, tokens[1], tokens[2])))
      return session
    }
    if (sub === 'delete') {
      if (!tokens[1] || !tokens[2]) {
        process.stderr.write('vavcli /file-session delete <fileId> <sessionId…>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => deleteFileSessions(rpc, tokens[1], tokens.slice(2))))
      return session
    }
    if (sub === 'force-delete' || sub === 'forceDelete') {
      if (!tokens[1] || !tokens[2]) {
        process.stderr.write('vavcli /file-session force-delete <fileId> <sessionId…>\n')
        return session
      }
      printJsonish(
        await withDaemon(target, (rpc) => forceDeleteFileSessions(rpc, tokens[1], tokens.slice(2)))
      )
      return session
    }
    if (sub === 'readonly' || sub === 'read-only') {
      const flag = (tokens[2] || 'on').toLowerCase()
      if (!tokens[1] || (flag !== 'on' && flag !== 'off')) {
        process.stderr.write('vavcli /file-session readonly <sessionId> [on|off]\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => setFileSessionReadOnly(rpc, tokens[1], flag === 'on')))
      return session
    }
    printJsonish(await withDaemon(target, (rpc) => listFileSessions(rpc, tokens[1])))
    return session
  }
  if (cmd === 'diff') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /diff needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const controls = await fetchControls(phone, session)
    const cwd =
      (controls && controls.type === 'controls' && typeof controls.workingDirectory === 'string'
        ? controls.workingDirectory
        : '') || ''
    const path = arg.trim()
    if (!cwd || !path) {
      process.stderr.write('vavcli /diff <path>  (session needs a workdir)\n')
      return session
    }
    printJsonish(await withDaemon(target, (rpc) => gitDiff(rpc, cwd, path)))
    return session
  }
  if (cmd === 'github') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /github needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const controls = await fetchControls(phone, session)
    const sessionCwd =
      controls && controls.type === 'controls' && typeof controls.workingDirectory === 'string'
        ? controls.workingDirectory
        : ''
    const tokens = arg.split(/\s+/).filter(Boolean)
    const looksLikePath = Boolean(tokens[0] && (/^[./]/.test(tokens[0]) || tokens[0].includes('/')))
    const sub = looksLikePath || !tokens[0] ? 'pulls' : tokens[0]
    const dir = looksLikePath ? arg : sessionCwd
    if (!dir) {
      process.stderr.write('vavcli /github: session has no workdir\n')
      return session
    }
    if (sub === 'pull') {
      const n = tokens[1] || ''
      if (!n) {
        process.stderr.write('vavcli /github pull <n>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => getGithubPullCli(rpc, dir, n)))
      return session
    }
    if (sub === 'actions' || sub === 'runs') {
      printJsonish(await withDaemon(target, (rpc) => listGithubActionsCli(rpc, dir)))
      return session
    }
    if (sub === 'run') {
      const n = tokens[1] || ''
      if (!n) {
        process.stderr.write('vavcli /github run <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => getGithubActionRunCli(rpc, dir, n)))
      return session
    }
    if (sub === 'releases') {
      printJsonish(await withDaemon(target, (rpc) => listGithubReleasesCli(rpc, dir)))
      return session
    }
    if (sub === 'pages' || sub === 'site') {
      printJsonish(await withDaemon(target, (rpc) => getGithubSiteCli(rpc, dir)))
      return session
    }
    printJsonish(await withDaemon(target, (rpc) => listGithubPulls(rpc, dir)))
    return session
  }
  if (cmd === 'timers') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /timers needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || 'list'
    if (sub === 'create') {
      printJsonish(await withDaemon(target, (rpc) => createTimer(rpc)))
      return session
    }
    if (sub === 'add') {
      const patch = { ...parseTimerPatch(tokens), ...parseTimerPatch(argv) }
      const title = patch.title
      const prompt = patch.prompt
      if (!title || prompt == null) {
        process.stderr.write('vavcli /timers add --title TEXT --prompt TEXT [--cron EXPR|--every-ms N]\n')
        return session
      }
      printJsonish(
        await withDaemon(target, (rpc) => createTimerJob(rpc, { ...patch, title, prompt }))
      )
      return session
    }
    if (sub === 'update') {
      const id = tokens[1] || ''
      const patch = { ...parseTimerPatch(tokens), ...parseTimerPatch(argv) }
      if (!id) {
        process.stderr.write('vavcli /timers update <id> [--title TEXT] [--prompt TEXT] [--enabled on|off]\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => updateTimer(rpc, id, patch)))
      return session
    }
    if (sub === 'get') {
      const id = tokens[1] || ''
      if (!id) {
        process.stderr.write('vavcli /timers get <conversationId>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => getTimerForConversation(rpc, id)))
      return session
    }
    if (sub === 'run') {
      const id = tokens[1] || ''
      if (!id) {
        process.stderr.write('vavcli /timers run <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => runTimer(rpc, id)))
      return session
    }
    if (sub === 'remove' || sub === 'delete') {
      const id = tokens[1] || ''
      if (!id) {
        process.stderr.write('vavcli /timers remove <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => removeTimer(rpc, id)))
      return session
    }
    if (sub === 'runs') {
      printJsonish(await withDaemon(target, (rpc) => listTimerRuns(rpc, tokens[1])))
      return session
    }
    if (sub === 'sessions') {
      printJsonish(await withDaemon(target, (rpc) => listTimerSessions(rpc)))
      return session
    }
    printJsonish(await withDaemon(target, (rpc) => listTimers(rpc)))
    return session
  }
  if (cmd === 'account') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /account needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const [sub, id] = tokens
    const flags = [...argv, ...tokens]
    if (!sub || sub === 'list') {
      printJsonish(await withDaemon(target, (rpc) => listAccounts(rpc)))
      return session
    }
    if (sub === 'draft') {
      printJsonish(await withDaemon(target, (rpc) => draftAccount(rpc, id || undefined)))
      return session
    }
    if (sub === 'remove') {
      if (!id) {
        process.stderr.write('vavcli /account remove <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => removeAccount(rpc, id)))
      return session
    }
    if (sub === 'oauth' || sub === 'login') {
      if (!id) {
        process.stderr.write('vavcli /account oauth <agent>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => beginAccountOAuth(rpc, id)))
      return session
    }
    if (sub === 'cancel') {
      if (!id) {
        process.stderr.write('vavcli /account cancel <agent>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => cancelAccountOAuth(rpc, id)))
      return session
    }
    if (sub === 'signout' || sub === 'sign-out') {
      if (!id) {
        process.stderr.write('vavcli /account signout <agent>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => signOutAccount(rpc, id)))
      return session
    }
    if (sub === 'update') {
      if (!id) {
        process.stderr.write('vavcli /account update <id> [--alias TEXT] [--endpoint URL] [--key TOKEN]\n')
        return session
      }
      printJsonish(
        await withDaemon(target, (rpc) =>
          updateAccount(rpc, id, {
            alias: argValueOrEq(flags, '--alias'),
            endpoint: argValueOrEq(flags, '--endpoint'),
            apiKey: argValueOrEq(flags, '--key')
          })
        )
      )
      return session
    }
    if (sub === 'current' || sub === 'use') {
      if (!id) {
        process.stderr.write('vavcli /account current <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => setCurrentAccount(rpc, id)))
      return session
    }
    if (sub === 'activate') {
      if (!id) {
        process.stderr.write('vavcli /account activate <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => activateAccount(rpc, id)))
      return session
    }
    if (sub === 'verify') {
      if (!id) {
        process.stderr.write('vavcli /account verify <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => verifyAccount(rpc, id, argValueOrEq(flags, '--key'))))
      return session
    }
    if (sub === 'reveal') {
      if (!id) {
        process.stderr.write('vavcli /account reveal <id>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => revealAccountKey(rpc, id)))
      return session
    }
    process.stderr.write(
      'vavcli /account [list|draft|remove|update|current|activate|verify|reveal|oauth <agent>|cancel <agent>|signout <agent>]\n'
    )
    return session
  }
  if (cmd === 'settings') {
    if (!target || target.kind !== 'tcp') {
      process.stderr.write('vavcli /settings needs a TCP vavd (--uri or --state)\n')
      return session
    }
    const tokens = arg.split(/\s+/).filter(Boolean)
    const sub = tokens[0] || 'get'
    if (sub === 'get') {
      printJsonish(await withDaemon(target, (rpc) => getHostSettings(rpc)))
      return session
    }
    if (sub === 'set') {
      const patch: Record<string, unknown> = {}
      for (let i = 1; i < tokens.length; i++) {
        const key = tokens[i]
        const value = tokens[i + 1]
        if (!value) continue
        if (key === '--model' || key === 'model') {
          patch.defaultModel = value
          i += 1
        } else if (key === '--approval' || key === 'approval') {
          patch.defaultApprovalMode = value
          i += 1
        } else if (key === '--thinking' || key === 'thinking') {
          patch.defaultThinkingLevel = value
          i += 1
        } else if (key === '--endpoint' || key === 'endpoint') {
          patch.apiEndpoint = value
          i += 1
        }
      }
      if (!Object.keys(patch).length) {
        process.stderr.write('vavcli /settings set --model ID | --approval MODE | --thinking LEVEL\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => updateHostSettings(rpc, patch)))
      return session
    }
    if (sub === 'secret') {
      const flags = [...argv, ...tokens]
      const slot = tokens[1] || ''
      const value = argValueOrEq(flags, '--set') || tokens[2] || ''
      if (!slot || !value) {
        process.stderr.write('vavcli /settings secret <slot> --set TOKEN\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => setHostSecret(rpc, slot, value)))
      return session
    }
    if (sub === 'hint') {
      const slot = tokens[1] || ''
      if (!slot) {
        process.stderr.write('vavcli /settings hint <slot>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => hintHostSecret(rpc, slot)))
      return session
    }
    if (sub === 'reveal-secret' || sub === 'revealSecret') {
      const slot = tokens[1] || ''
      if (!slot) {
        process.stderr.write('vavcli /settings reveal-secret <slot>\n')
        return session
      }
      printJsonish(await withDaemon(target, (rpc) => revealHostSecret(rpc, slot)))
      return session
    }
    process.stderr.write(
      'vavcli /settings [get|set --model ID --approval MODE --thinking LEVEL|secret|hint|reveal-secret]\n'
    )
    return session
  }
  process.stderr.write(`unknown slash command: /${cmd}  (try /help)\n`)
  return session
}

function printJsonish(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function runInteractive(
  phone: PhoneClient,
  session: string,
  target: VavdTarget
): Promise<number> {
  printLine(`vav-cli session ${session}  (Ctrl+C or /quit to exit; /help for commands)`)
  const rl = createInterface({
    input,
    output,
    crlfDelay: Infinity,
    prompt: 'vav-cli> '
  })
  rl.prompt()
  const lines = (async function* () {
    for await (const line of rl) {
      yield String(line).replace(/\r$/, '')
      rl.prompt()
    }
  })()
  try {
    return await runVavcliLines(phone, session, lines, (current, line) =>
      handleSlash(phone, current, line, target)
    )
  } finally {
    rl.close()
  }
}

export async function runVavcli(argv: string[] = process.argv): Promise<number> {
  if (argv.includes('--version') || argv.includes('-V')) {
    printLine(packageVersion())
    return 0
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(vavcliHelp())
    return 0
  }

  const mode = modeOf(argv)
  const target = await resolveVavdTarget({ argv })
  const phone = await connectPhoneTarget(target, 'vavcli')
  try {
    const session = await prepareSession(phone, argv)
    if (mode === 'rpc') return await runRpc(phone, session, 'json')
    const intent = vavcliArgvIntent(argv)
    if (intent.slashes.length) {
      let current = session
      for (const line of intent.slashes) {
        const next = await handleSlash(phone, current, line, target, argv)
        if (next === 'quit') return 0
        if (next) current = next
      }
      if (!intent.prompt) return 0
    }
    const prompt = intent.prompt
    if (prompt) {
      const turn = await streamTurn(phone, session, prompt, mode === 'json' ? 'json' : 'text')
      return turn.phase === 'error' ? 1 : 0
    }
    if (!input.isTTY) {
      const chunks: Buffer[] = []
      for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        process.stderr.write('vavcli: pass -p "query" or pipe a prompt on stdin\n')
        return 2
      }
      const turn = await streamTurn(phone, session, text, mode === 'json' ? 'json' : 'text')
      return turn.phase === 'error' ? 1 : 0
    }
    return await runInteractive(phone, session, target)
  } finally {
    phone.close()
  }
}

const entry = process.argv[1] || ''
if (/(?:^|[\\/])vavcli\.(ts|js)$/.test(entry)) {
  void runVavcli().then(
    (code) => {
      process.exit(code)
    },
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
      process.exit(1)
    }
  )
}
