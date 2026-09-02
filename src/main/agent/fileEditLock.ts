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

/** Terminal commands treated as read-only under Auto approval / file Read mode. */
const READONLY_TERMINAL =
  /^(?:cat|ls|grep|rg|head|tail|wc|pwd|echo|which|type|file|stat|find|tree|du|df|uname|date|whoami|id|env|printenv|realpath|basename|dirname|md5|shasum|sha256sum|hexdump|xxd|jq|yq|sed\s+-n|awk)\b/

export function isReadonlyTerminalCommand(command: string): boolean {
  const cmd = command.trim()
  // Reject obvious write redirects / mutators even if the head looks read-only.
  if (/[>]{1,2}|tee\b|\brm\b|\bmv\b|\bcp\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bsed\s+-i|\btruncate\b|\bdd\b/.test(cmd)) {
    return false
  }
  return READONLY_TERMINAL.test(cmd)
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
