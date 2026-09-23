import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatAppResourceUrl } from '../../shared/appResourceUrl.ts'
import { appOpFromArgs, createAppTools, isAppMutatingOp, type AppResourceHost } from './toolsApp.ts'
import type { ToolHost } from './toolHost.ts'

function mockHost(app: AppResourceHost): ToolHost {
  return { appResources: app } as ToolHost
}

describe('app tool', () => {
  it('classifies mutating ops', () => {
    assert.equal(appOpFromArgs('app', { op: 'Write' }), 'write')
    assert.equal(isAppMutatingOp('write'), true)
    assert.equal(isAppMutatingOp('create'), true)
    assert.equal(isAppMutatingOp('list'), false)
  })

  it('lists catalog URLs', async () => {
    const url = formatAppResourceUrl({ kind: 'storage', path: '/tmp/a.md', id: 's1' })
    const [tool] = createAppTools(
      mockHost({
        list: () => [
          { url, kind: 'storage', title: 'a.md', id: 's1', path: '/tmp/a.md' }
        ],
        resolve: () => null,
        read: async () => ({ error: 'no' }),
        write: async () => ({ error: 'no' }),
        create: async () => ({ error: 'no' }),
        remove: async () => ({ error: 'no' })
      })
    )
    const result = await tool.execute('1', { op: 'list', kind: 'storage' }, new AbortController().signal, () => {})
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.match(text, /a\.md/)
    assert.match(text, /vav:\/\/app\/storage/)
  })

  it('creates through the host', async () => {
    const calls: Array<{ kind?: string; title?: string }> = []
    const [tool] = createAppTools(
      mockHost({
        list: () => [],
        resolve: () => null,
        read: async () => ({ error: 'no' }),
        write: async () => ({ error: 'no' }),
        create: async (input) => {
          calls.push({ kind: input.kind, title: input.title })
          return { url: 'vav://app/knowledge?id=n1', title: input.title || 'Note' }
        },
        remove: async () => ({ error: 'no' })
      })
    )
    const result = await tool.execute(
      '1',
      { op: 'create', kind: 'knowledge', title: 'Launch', content: '# Launch' },
      new AbortController().signal,
      () => {}
    )
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.deepEqual(calls, [{ kind: 'knowledge', title: 'Launch' }])
    assert.match(text, /Created Launch/)
    assert.match(text, /vav:\/\/app\/knowledge/)
  })

  it('gets the focused app item when url is omitted', async () => {
    const focused = 'vav://app/knowledge?id=kh1'
    const [tool] = createAppTools(
      mockHost({
        list: () => [],
        resolve: () => null,
        focusedUrl: () => focused,
        read: async (url) => {
          if (url !== focused) return { error: `unexpected ${url}` }
          return { text: '# Meeting', title: 'Meeting notes', url }
        },
        write: async () => ({ error: 'no' }),
        create: async () => ({ error: 'no' }),
        remove: async () => ({ error: 'no' })
      })
    )
    const result = await tool.execute('1', { op: 'get' }, new AbortController().signal, () => {})
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.match(text, /Meeting notes/)
    assert.match(text, /# Meeting/)
  })
})

describe('analysis, schedule, and storage tools', () => {
  it('creates an analysis dataset, a schedule, and a storage file through the app host', async () => {
    const calls: Array<{ kind: string }> = []
    const tools = createAppTools(
      mockHost({
        list: () => [],
        resolve: () => null,
        read: async () => ({ error: 'no' }),
        write: async () => ({ error: 'no' }),
        create: async (input) => {
          calls.push({ kind: input.kind })
          return { url: `vav://app/${input.kind}?id=1`, title: input.title || input.kind }
        },
        remove: async () => ({ error: 'no' })
      })
    )
    const analysis = tools.find((tool) => tool.name === 'analysis_write')!
    const schedule = tools.find((tool) => tool.name === 'schedule_write')!
    const storage = tools.find((tool) => tool.name === 'storage_write')!
    const signal = new AbortController().signal
    const created = await analysis.execute(
      '1',
      { title: 'Sales', path: '/tmp/sales.csv' },
      signal,
      () => {}
    )
    const scheduled = await schedule.execute(
      '2',
      { title: 'Digest', prompt: 'Summarize', schedule: '0 9 * * *' },
      signal,
      () => {}
    )
    const stored = await storage.execute(
      '3',
      { path: '/tmp/keep.md', content: '# Keep' },
      signal,
      () => {}
    )
    assert.deepEqual(calls, [{ kind: 'data' }, { kind: 'scheduled' }, { kind: 'storage' }])
    const text = (result: { content: Array<{ type: string; text?: string }> }) =>
      result.content[0] && 'text' in result.content[0] ? result.content[0].text ?? '' : ''
    assert.match(text(created), /vav:\/\/app\/data/)
    assert.match(text(scheduled), /vav:\/\/app\/scheduled/)
    assert.match(text(stored), /vav:\/\/app\/storage/)
  })

  it('creates a schedule without a prompt and still allows enable', async () => {
    const created: Array<{ prompt?: string; enabled?: boolean }> = []
    const tools = createAppTools(
      mockHost({
        list: () => [],
        resolve: () => null,
        read: async () => ({ error: 'no' }),
        write: async () => ({ error: 'no' }),
        create: async (input) => {
          created.push({ prompt: input.prompt, enabled: input.enabled })
          return { url: 'vav://app/scheduled?id=1', title: input.title || 'scheduled' }
        },
        remove: async () => ({ error: 'no' })
      })
    )
    const schedule = tools.find((tool) => tool.name === 'schedule_write')!
    const result = await schedule.execute(
      '1',
      { title: 'Later', enabled: true },
      new AbortController().signal,
      () => {}
    )
    assert.deepEqual(created, [{ prompt: '', enabled: true }])
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text ?? '' : ''
    assert.match(text, /vav:\/\/app\/scheduled/)
  })
})
