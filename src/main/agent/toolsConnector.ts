import type { ConnectorActionKind, ConnectorId } from '@shared/connector'
import { isConnectorId, parseConnectorAction } from '@shared/connector'
import { TOOL_LABELS } from '@shared/types'
import { Type, defineTool, failure, type ToolHost } from './toolHost'
import { cap } from './toolSummarize'

export function createConnectorTools(host: ToolHost) {
  const connector = defineTool({
    name: 'connector',
    label: TOOL_LABELS.connector,
    description: [
      'Talk to a first-class VAV connector (github, cloudflare, supabase, vercel).',
      'op=list — catalog. op=probe — which connectors bind this workspace.',
      'op=act action=deploy — run that service\'s deploy CLI (approval required).',
      'Not a skill and not an MCP plugin. GitHub is read-only.'
    ].join(' '),
    parameters: Type.Object({
      op: Type.String({ description: 'list | probe | act' }),
      connector: Type.Optional(Type.String({ description: 'github | cloudflare | supabase | vercel' })),
      action: Type.Optional(Type.String({ description: 'deploy' }))
    }),
    async execute(_id, params) {
      if (!host.connectors) return failure('Connectors are unavailable')
      const op = String(params.op ?? 'list').trim().toLowerCase()
      if (op === 'list') {
        const rows = host.connectors.catalog()
        const text = rows
          .map((row) => `- ${row.id}: ${row.capabilities.join(', ')}`)
          .join('\n')
        return { content: [{ type: 'text', text }], details: { display: text, summary: `${rows.length} connectors` } }
      }
      if (op === 'probe') {
        const rows = await host.connectors.probe(host.workdir)
        const text = rows
          .map((row) => {
            const bind = row.binding.present ? row.binding.label || 'bound' : 'not bound'
            const auth = row.auth.present ? row.auth.source || 'yes' : 'no auth'
            return `- ${row.id}: ${bind} · ${auth}`
          })
          .join('\n')
        return { content: [{ type: 'text', text: cap(text) }], details: { display: text, summary: 'connector probe' } }
      }
      if (op === 'act') {
        if (host.isTimerSession?.() === false && host.settings().defaultApprovalMode === 'readonly') {
          return failure('Connector deploy needs write approval')
        }
        const id = String(params.connector ?? '') as ConnectorId
        if (!isConnectorId(id)) return failure('Unknown connector')
        const action = parseConnectorAction(params.action) as ConnectorActionKind | null
        if (!action) return failure('Unknown action (use deploy)')
        const result = await host.connectors.act({
          connector: id,
          action,
          cwd: host.workdir,
          conversationId: host.conversationId
        })
        if (!result.ok) return failure(result.error)
        const text = [result.summary, result.url, result.output].filter(Boolean).join('\n')
        return {
          content: [{ type: 'text', text: cap(text) }],
          details: { display: text, summary: result.summary }
        }
      }
      return failure('Unknown op (list | probe | act)')
    }
  })
  return { connector }
}
