import { TOOL_LABELS } from '@shared/types'
import { Type, defineTool, failure, type ToolHost } from './toolHost'

export function createComputerTools(host: ToolHost) {
  if (!host.computer?.available()) return []

  const computerList = defineTool({
    name: 'computer_list',
    label: TOOL_LABELS.computer_list,
    description:
      'List running apps and top-level windows on this Mac/PC (pid + window_id). Use before computer_observe / computer_act. Does not move the cursor or change focus. Prefer this over guessing window ids.',
    parameters: Type.Object({}),
    async execute() {
      if (!host.computer) return failure('Computer use is unavailable')
      try {
        const result = await host.computer.list()
        if (!result.ok) return failure(result.text)
        return {
          content: [{ type: 'text' as const, text: result.text }],
          details: { display: result.text }
        }
      } catch (err) {
        return failure(err instanceof Error ? err.message : String(err))
      }
    }
  })

  const computerObserve = defineTool({
    name: 'computer_observe',
    label: TOOL_LABELS.computer_observe,
    description:
      'Snapshot one window: accessibility tree with element_index / element_token, plus a window screenshot path. Required before click/type/key. Does not raise the window or move the real pointer. Pass pid and window_id from computer_list.',
    parameters: Type.Object({
      pid: Type.Number({ description: 'Process id that owns the window.' }),
      window_id: Type.Number({ description: 'window_id from computer_list.' }),
      query: Type.Optional(
        Type.String({ description: 'Optional case-insensitive filter over the AX tree.' })
      )
    }),
    async execute(_id, params) {
      if (!host.computer) return failure('Computer use is unavailable')
      try {
        const result = await host.computer.observe({
          pid: params.pid,
          window_id: params.window_id,
          query: params.query
        })
        if (!result.ok) return failure(result.text)
        return {
          content: [{ type: 'text' as const, text: result.text }],
          details: { display: result.text }
        }
      } catch (err) {
        return failure(err instanceof Error ? err.message : String(err))
      }
    }
  })

  const computerAct = defineTool({
    name: 'computer_act',
    label: TOOL_LABELS.computer_act,
    description:
      'Act on one bound window in the background (no focus steal, real mouse stays put). kind=click|type|key|launch. click/type/key require pid + window_id. Prefer element_token from the latest computer_observe; use x,y only for canvas. delivery_mode is forced to background — do not request foreground or activate. launch takes bundle_id only. If a background action does not land, tell the user; do not escalate.',
    parameters: Type.Object({
      kind: Type.String({ description: 'click, type, key, or launch.' }),
      pid: Type.Optional(Type.Number({ description: 'Required except launch.' })),
      window_id: Type.Optional(Type.Number({ description: 'Required except launch.' })),
      element_token: Type.Optional(Type.String({ description: 'Preferred target from observe.' })),
      element_index: Type.Optional(Type.Number({ description: 'Requires snapshot_id.' })),
      snapshot_id: Type.Optional(Type.String({ description: 'From the latest observe of this window.' })),
      x: Type.Optional(Type.Number({ description: 'Window-screenshot pixels; canvas fallback.' })),
      y: Type.Optional(Type.Number({ description: 'Window-screenshot pixels; canvas fallback.' })),
      text: Type.Optional(Type.String({ description: 'For kind=type.' })),
      key: Type.Optional(Type.String({ description: 'For kind=key, e.g. Return, Escape.' })),
      bundle_id: Type.Optional(Type.String({ description: 'For kind=launch.' }))
    }),
    async execute(_id, params) {
      if (!host.computer) return failure('Computer use is unavailable')
      try {
        const result = await host.computer.act(params as Record<string, unknown>)
        if (!result.ok) return failure(result.text)
        return {
          content: [{ type: 'text' as const, text: result.text }],
          details: { display: result.text }
        }
      } catch (err) {
        return failure(err instanceof Error ? err.message : String(err))
      }
    }
  })

  return [computerList, computerObserve, computerAct]
}
