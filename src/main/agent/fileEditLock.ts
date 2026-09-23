import type { ToolName } from '../../shared/types.ts'

/**
 * Tools that stay offered in file-preview Read mode but hard-fail at execute
 * until the session is switched to Edit (via switch_mode or the UI).
 */
export const FILE_READONLY_BLOCKED_TOOLS: ReadonlySet<ToolName> = new Set(['fs_write'])

/** Formats that cannot switch to in-place Edit (need convert / Save As). */
export function isFileEditLockedPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  if (/\.(heic|heif|hif)$/i.test(filePath)) return true
  if (/\.pdf$/i.test(filePath)) return true
  if (/\.(doc|ppt|xls)$/i.test(filePath) && !/\.(docx|pptx|xlsx)$/i.test(filePath)) return true
  if (/\.zip$/i.test(filePath)) return true
  if (/\.drawio$/i.test(filePath)) return true
  return false
}

export const FILE_EDIT_LOCKED_SWITCH_MESSAGE =
  'This format cannot switch to Edit in-place (PDF / HEIC / legacy Office / ZIP). ' +
  'Ask the user to convert or Save As from the preview chrome.'

/**
 * Error when flipping file-preview Read/Edit is illegal. `null` means the
 * caller may no-op if `fileReadOnly` already matches, or persist the flip.
 */
export function fileReadOnlySwitchBlock(
  conversation:
    | {
        focusedFilePath?: string | null
        fileId?: string | null
      }
    | null
    | undefined,
  readOnly: boolean,
  pathForFileId?: ((fileId: string) => string | null | undefined) | null
): string | null {
  if (!conversation) return 'Conversation not found.'
  if (!readOnly) {
    const path =
      conversation.focusedFilePath ||
      (conversation.fileId && pathForFileId ? (pathForFileId(conversation.fileId) ?? null) : null)
    if (isFileEditLockedPath(path)) return FILE_EDIT_LOCKED_SWITCH_MESSAGE
  }
  return null
}

/** Terminal commands treated as read-only under Auto approval / file Read mode. */
const READONLY_BINS = new Set([
  'cat',
  'ls',
  'grep',
  'rg',
  'head',
  'tail',
  'wc',
  'pwd',
  'echo',
  'which',
  'type',
  'file',
  'stat',
  'find',
  'tree',
  'du',
  'df',
  'uname',
  'date',
  'whoami',
  'id',
  'printenv',
  'env',
  'realpath',
  'basename',
  'dirname',
  'md5',
  'shasum',
  'sha256sum',
  'hexdump',
  'xxd',
  'jq',
  'yq',
  'sed'
])

const FIND_DENIED = /^-exec|^-ok|^-fprint|^-delete$/

/** Quote-aware split. `null` if the line has control / substitution / redirect syntax. */
export function tokenizeReadonlyShell(command: string): string[] | null {
  const tokens: string[] = []
  let i = 0
  const s = command
  const n = s.length
  while (i < n) {
    while (i < n && (s[i] === ' ' || s[i] === '\t')) i++
    if (i >= n) break
    const c = s[i]!
    if (c === '#') break
    if (c === '\n' || c === '\r' || c === ';' || c === '|' || c === '&') return null
    if (c === '>' || c === '<') return null
    if (c === '`') return null
    if (c === '$' && (s[i + 1] === '(' || s[i + 1] === '{')) return null
    let token = ''
    let quote: '"' | "'" | null = null
    while (i < n) {
      const ch = s[i]!
      if (quote) {
        if (ch === quote) {
          quote = null
          i++
          continue
        }
        if (quote === '"' && ch === '\\' && i + 1 < n) {
          token += s[i + 1]
          i += 2
          continue
        }
        if (quote === '"' && (ch === '`' || (ch === '$' && (s[i + 1] === '(' || s[i + 1] === '{')))) {
          return null
        }
        token += ch
        i++
        continue
      }
      if (ch === "'" || ch === '"') {
        quote = ch
        i++
        continue
      }
      if (ch === '\\' && i + 1 < n) {
        token += s[i + 1]
        i += 2
        continue
      }
      if (ch === ' ' || ch === '\t') break
      if (ch === '\n' || ch === '\r' || ch === ';' || ch === '|' || ch === '&') return null
      if (ch === '>' || ch === '<') return null
      if (ch === '`') return null
      if (ch === '$' && (s[i + 1] === '(' || s[i + 1] === '{')) return null
      token += ch
      i++
    }
    if (quote) return null
    if (token) tokens.push(token)
  }
  return tokens
}

function isReadonlySed(args: string[]): boolean {
  const hasN = args.some((arg) => arg === '-n' || (arg.startsWith('-') && !arg.startsWith('--') && arg.includes('n')))
  if (!hasN) return false
  if (args.some((arg) => arg === '-i' || arg.startsWith('-i') || arg.startsWith('--in-place'))) return false
  return !args.some((arg) => /(^|[;\n])\s*[we]\b/.test(arg))
}

function isReadonlyFind(args: string[]): boolean {
  return !args.some((arg) => FIND_DENIED.test(arg))
}

export function isReadonlyTerminalCommand(command: string): boolean {
  const tokens = tokenizeReadonlyShell(command.trim())
  if (!tokens || tokens.length === 0) return false
  const bin = tokens[0]!
  if (!READONLY_BINS.has(bin)) return false
  const args = tokens.slice(1)
  if (bin === 'env') return args.length === 0
  if (bin === 'sed') return isReadonlySed(args)
  if (bin === 'find') return isReadonlyFind(args)
  return true
}

export type ToolExecuteResult = {
  content: Array<{ type: 'text'; text: string }>
  details: { display: string; failed: true }
}

export function readonlyWriteRefusal(): ToolExecuteResult {
  return {
    content: [
      {
        type: 'text',
        text: 'Read-only session: call switch_mode with mode "edit" first (user may need to Approve), or ask them to switch the preview to Edit / convert / Save As.'
      }
    ],
    details: {
      display: '已拦截：当前为 Read 模式 — 先 switch_mode → Edit。',
      failed: true
    }
  }
}

export function readonlyTerminalRefusal(command: string): ToolExecuteResult {
  return {
    content: [
      {
        type: 'text',
        text: `Read-only session: refused non-read-only shell command. Call switch_mode (mode: "edit") first, or use ls/cat/grep/rg/head/tail.\nRefused: ${command}`
      }
    ],
    details: {
      display: `已拦截（Read 模式仅允许只读 shell）：\n$ ${command}`,
      failed: true
    }
  }
}

function terminalCommandOf(params: unknown): string {
  return params && typeof params === 'object' && 'command' in params
    ? String((params as { command: unknown }).command ?? '')
    : ''
}

/** Execute-time Read-mode gate. `null` means the call may proceed. */
export function gateReadonlyExecute(
  readOnly: boolean,
  toolName: string,
  params: unknown
): ToolExecuteResult | null {
  if (!readOnly) return null
  if (FILE_READONLY_BLOCKED_TOOLS.has(toolName as ToolName)) return readonlyWriteRefusal()
  if (toolName === 'terminal') {
    const command = terminalCommandOf(params)
    if (command && !isReadonlyTerminalCommand(command)) return readonlyTerminalRefusal(command)
  }
  return null
}

/**
 * Gate on the original args, then prefer an Edit-mode override for execute.
 * The gate must not see the override — rewritten writes still need Read to flip first.
 */
export function resolveGatedToolParams<P>(
  readOnly: boolean,
  toolName: string,
  params: P,
  override: P | undefined
): { blocked: ToolExecuteResult } | { params: P } {
  const blocked = gateReadonlyExecute(readOnly, toolName, params)
  if (blocked) return { blocked }
  return { params: override ?? params }
}

/** Gate then execute; blocked Read-mode calls resolve as a failed tool result. */
export function executeGatedTool<P, R>(
  readOnly: boolean,
  toolName: string,
  params: P,
  override: P | undefined,
  execute: (params: P) => R
): R | Promise<ToolExecuteResult> {
  const gated = resolveGatedToolParams(readOnly, toolName, params, override)
  if ('blocked' in gated) return Promise.resolve(gated.blocked)
  return execute(gated.params)
}
