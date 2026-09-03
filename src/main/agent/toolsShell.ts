import { dirname } from 'node:path'
import { TOOL_LABELS } from '@shared/types'
import { BASH_SESSION_ID } from '../terminal/StickyShell'
import { t } from '../i18n'
import { cap, looksLikeServerCommand } from './toolSummarize'
import { Type, defineTool, failure, type ToolHost } from './toolHost'

export function createShellTools(host: ToolHost) {
  const terminal = defineTool({
    name: 'terminal',
    label: TOOL_LABELS.terminal,
    description:
      'Run a shell command. Wait mode (default) blocks until exit. Fire-and-forget (background=true) starts services/daemons and returns immediately with {status,pid,sessionId}; then use wait or read_bash_session.',
    parameters: Type.Object({
      command: Type.String({ description: 'The shell command to run.' }),
      background: Type.Optional(
        Type.Boolean({
          description:
            'Fire-and-forget: for servers/daemons that do not exit (npm run dev, uvicorn, …). Returns immediately; follow with wait / read_bash_session.'
        })
      )
    }),
    async execute(_id, params, signal) {
      let command = params.command.trim()
      if (!command) return failure('缺少 command 参数')
      if (host.files.workingCopies) {
        command = host.files.workingCopies.rewriteCommand(command)
      }

      const timeout = host.settings().commandTimeout
      const background = params.background === true || looksLikeServerCommand(command)
      const shell = host.shell()
      host.mirror(`$ ${command}${background ? '  # background' : ''}\n`)
      const result = background
        ? await shell.runBackground(command, (chunk) => host.mirror(chunk), signal)
        : await shell.run(command, timeout, (chunk) => host.mirror(chunk), signal)

      if (result.cancelled) {
        host.mirror(`\n${t('common.cancelled')}\n`)
        const body = result.output
        return {
          content: [{ type: 'text', text: cap(`${body}\n[${t('common.cancelled')}]`) }],
          details: {
            display: `${body}${body && !body.endsWith('\n') ? '\n' : ''}${t('tool.cancelled')}`,
            failed: true
          }
        }
      }
      if (result.timedOut) {
        host.mirror(`exit ${result.exitCode}\n`)
        return {
          content: [
            { type: 'text', text: cap(`Command timed out after ${timeout}s.\n${result.output}`) }
          ],
          details: {
            display: `命令超时（${timeout}s），已终止该次 terminal 工具。\n${result.output}`,
            failed: true
          }
        }
      }
      if (result.backgroundPid != null) {
        const payload = {
          status: 'running' as const,
          pid: result.backgroundPid,
          sessionId: shell.sessionId
        }
        host.mirror(`background pid ${result.backgroundPid}\n`)
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          details: {
            display: `后台运行 · pid ${result.backgroundPid}`,
            failed: false
          }
        }
      }
      const body = result.output
      const transcript = `$ ${command}\n${body}${body && !body.endsWith('\n') ? '\n' : ''}exit ${result.exitCode}\n`
      host.mirror(`exit ${result.exitCode}\n`)
      if (host.files.workingCopies) {
        void host.files.workingCopies.scanDirtiedCopies().then((paths) => {
          for (const p of paths) {
            host.fsChanged(dirname(p), p)
          }
        })
      }
      return {
        content: [{ type: 'text', text: cap(`${result.output}\n[exit ${result.exitCode}]`) }],
        details: { display: transcript, failed: result.exitCode !== 0 }
      }
    }
  })

  const wait = defineTool({
    name: 'wait',
    label: TOOL_LABELS.wait,
    description:
      'Wait for a previously fire-and-forget terminal session to print a pattern (e.g. "listening on"). Blocks until match or timeout.',
    parameters: Type.Object({
      sessionId: Type.Optional(
        Type.String({ description: `Bash session id (default "${BASH_SESSION_ID}").` })
      ),
      expect: Type.String({
        description: 'Regex or literal substring to watch for in stdout/stderr.'
      }),
      timeoutMs: Type.Optional(
        Type.Number({ description: 'Milliseconds to wait (default 60000).' })
      )
    }),
    async execute(_id, params, signal) {
      const sessionId = String(params.sessionId ?? BASH_SESSION_ID)
      const shell = host.shell()
      if (sessionId !== shell.sessionId) {
        return failure(`未知 sessionId「${sessionId}」（当前仅支持 ${shell.sessionId}）`)
      }
      const expect = String(params.expect ?? '').trim()
      if (!expect) return failure('缺少 expect 参数')
      const timeoutMs = Number(params.timeoutMs ?? 60_000)
      const result = await shell.waitFor(expect, timeoutMs, signal)
      const seconds = (result.elapsedMs / 1000).toFixed(1)
      if (result.cancelled) {
        return {
          content: [
            {
              type: 'text',
              text: cap(
                JSON.stringify({
                  matched: false,
                  cancelled: true,
                  output_since_start: result.output,
                  elapsedMs: result.elapsedMs
                })
              )
            }
          ],
          details: {
            display: `${t('tool.cancelled')}\n${result.output}`,
            failed: true
          }
        }
      }
      if (result.matched) {
        return {
          content: [
            {
              type: 'text',
              text: cap(
                JSON.stringify({
                  matched: true,
                  output_since_start: result.output,
                  elapsedMs: result.elapsedMs
                })
              )
            }
          ],
          details: {
            display: `matched: ${expect} (${seconds}s)\n${result.output}`,
            failed: false
          }
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: cap(
              JSON.stringify({
                matched: false,
                output_since_start: result.output,
                elapsedMs: result.elapsedMs
              })
            )
          }
        ],
        details: {
          display: `timeout ${seconds}s · expect: ${expect}\n${result.output || '（无新输出）'}`,
          failed: true
        }
      }
    }
  })

  const readBashSession = defineTool({
    name: 'read_bash_session',
    label: TOOL_LABELS.read_bash_session,
    description:
      'Read the current scrollback of the bash session without waiting. Use to poll a fire-and-forget service.',
    parameters: Type.Object({
      sessionId: Type.Optional(
        Type.String({ description: `Bash session id (default "${BASH_SESSION_ID}").` })
      ),
      tailLines: Type.Optional(
        Type.Number({ description: 'How many trailing lines to return (default 200).' })
      )
    }),
    async execute(_id, params) {
      const sessionId = String(params.sessionId ?? BASH_SESSION_ID)
      const shell = host.shell()
      if (sessionId !== shell.sessionId) {
        return failure(`未知 sessionId「${sessionId}」（当前仅支持 ${shell.sessionId}）`)
      }
      const tail = shell.readTail(Number(params.tailLines ?? 200))
      return {
        content: [{ type: 'text', text: cap(tail || '(empty)') }],
        details: { display: tail || '（空）' }
      }
    }
  })

  return [terminal, wait, readBashSession]
}
