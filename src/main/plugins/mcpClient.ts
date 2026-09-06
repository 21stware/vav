/**
 * Minimal MCP stdio client so VAV actually consumes ~/.vav MCP configs.
 * One process per server; tools/list is cached until plugins change.
 */
import { spawn } from 'node:child_process'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { PluginMcpServer } from '../../shared/plugins.ts'
import { cap } from '../agent/toolSummarize.ts'
import { defineTool, failure } from '../agent/toolHost.ts'
import { asArray, asRecord, asString, onJsonLines } from '../agent/drivers/stdioJson.ts'

type McpToolInfo = {
  name: string
  description?: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

type Session = {
  server: PluginMcpServer
  write: (obj: unknown) => void
  kill: () => void
  pending: Map<number, Pending>
  tools: McpToolInfo[]
  nextId: number
}

const CALL_TIMEOUT_MS = 30_000

export class McpToolBridge {
  private sessions = new Map<string, Session>()
  private listed: AgentTool[] = []
  private fingerprint = ''

  dispose(): void {
    for (const session of this.sessions.values()) session.kill()
    this.sessions.clear()
    this.listed = []
    this.fingerprint = ''
  }

  invalidate(): void {
    this.dispose()
  }

  async toolsFor(servers: PluginMcpServer[]): Promise<AgentTool[]> {
    const next = servers
      .map(
        (server) =>
          `${server.name}|${server.command ?? ''}|${(server.args ?? []).join(' ')}|${server.url ?? ''}`
      )
      .join(';')
    if (this.listed.length && this.sessions.size && this.fingerprint === next) return this.listed
    this.dispose()
    this.fingerprint = next
    const tools: AgentTool[] = []
    for (const server of servers) {
      if (!server.command) continue
      try {
        const session = await this.connect(server)
        this.sessions.set(server.name, session)
        for (const info of session.tools) {
          tools.push(this.wrap(server.name, info))
        }
      } catch (err) {
        console.warn('[plugins] MCP connect failed', server.name, err)
      }
    }
    this.listed = tools
    return tools
  }

  private wrap(serverName: string, info: McpToolInfo): AgentTool {
    const toolName = `mcp_${sanitizeTool(serverName)}_${sanitizeTool(info.name)}`
    return defineTool({
      name: toolName,
      label: info.name,
      description: [
        `MCP tool \`${info.name}\` from server \`${serverName}\`.`,
        info.description || 'Arguments are a JSON object in `arguments`.'
      ].join(' '),
      parameters: Type.Object({
        arguments: Type.Optional(
          Type.String({
            description: 'JSON object of tool arguments (default {}).'
          })
        )
      }),
      execute: async (_id, params) => {
        let args: Record<string, unknown> = {}
        const raw = params.arguments
        if (typeof raw === 'string' && raw.trim()) {
          try {
            const parsed = JSON.parse(raw) as unknown
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>
            } else return failure('arguments must be a JSON object')
          } catch {
            return failure('arguments is not valid JSON')
          }
        }
        const session = this.sessions.get(serverName)
        if (!session) return failure(`MCP server "${serverName}" is not connected`)
        try {
          const result = await request(session, 'tools/call', { name: info.name, arguments: args })
          const text = mcpResultText(result)
          return {
            content: [{ type: 'text' as const, text: cap(text) }],
            details: { display: text, summary: `${serverName}/${info.name}` }
          }
        } catch (err) {
          return failure((err as Error).message)
        }
      }
    })
  }

  private connect(server: PluginMcpServer): Promise<Session> {
    return new Promise((resolve, reject) => {
      const child = spawn(server.command!, server.args ?? [], {
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const pending = new Map<number, Pending>()
      const session: Session = {
        server,
        write: (obj) => {
          child.stdin?.write(`${JSON.stringify(obj)}\n`)
        },
        kill: () => {
          try {
            child.kill('SIGTERM')
          } catch {
            /* ignore */
          }
        },
        pending,
        tools: [],
        nextId: 1
      }
      if (child.stdout) {
        onJsonLines(child.stdout, (value) => {
          const rec = asRecord(value)
          const id = rec?.id
          if (typeof id === 'number') {
            const waiter = pending.get(id)
            if (!waiter) return
            pending.delete(id)
            if (rec?.error) {
              const err = asRecord(rec.error)
              waiter.reject(new Error(asString(err?.message) || 'MCP error'))
            } else waiter.resolve(rec?.result)
          }
        })
      }
      child.on('error', (err) => reject(err))
      child.on('exit', () => {
        for (const waiter of pending.values()) waiter.reject(new Error('MCP server exited'))
        pending.clear()
      })
      void (async () => {
        try {
          await request(session, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'vav', version: '1.0' }
          })
          session.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
          const listed = asRecord(await request(session, 'tools/list', {}))
          session.tools = (asArray(listed?.tools) ?? [])
            .map((item) => {
              const row = asRecord(item)
              const name = asString(row?.name)
              if (!name) return null
              return { name, description: asString(row?.description) ?? undefined }
            })
            .filter((row): row is McpToolInfo => row != null)
          resolve(session)
        } catch (err) {
          session.kill()
          reject(err)
        }
      })()
    })
  }
}

function request(session: Session, method: string, params: unknown): Promise<unknown> {
  const id = session.nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(id)
      reject(new Error(`MCP ${method} timed out`))
    }, CALL_TIMEOUT_MS)
    session.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      }
    })
    session.write({ jsonrpc: '2.0', id, method, params })
  })
}

function mcpResultText(result: unknown): string {
  const rec = asRecord(result)
  const content = asArray(rec?.content)
  if (content) {
    return content
      .map((item) => {
        const row = asRecord(item)
        return asString(row?.text) || JSON.stringify(row ?? item)
      })
      .join('\n')
  }
  if (typeof rec?.text === 'string') return rec.text
  return JSON.stringify(result ?? {}, null, 2)
}

function sanitizeTool(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}
