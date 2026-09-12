import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createComputerTools } from './toolsComputer.ts'
import type { ToolHost } from './toolHost.ts'

const stub = {
  workdir: '/tmp',
  conversationId: 'c1',
  settings: () => ({}) as ReturnType<ToolHost['settings']>,
  files: {} as ToolHost['files'],
  shell: () => ({}) as ReturnType<ToolHost['shell']>,
  mirror: () => undefined,
  fsChanged: () => undefined,
  ask: async () => ({ text: '', cancelled: false })
} as ToolHost

describe('createComputerTools', () => {
  it('offers nothing when the driver is down', () => {
    assert.equal(createComputerTools(stub).length, 0)
    assert.equal(
      createComputerTools({
        ...stub,
        computer: { available: () => false } as ToolHost['computer']
      }).length,
      0
    )
  })

  it('registers list / observe / act when the driver is up', () => {
    const tools = createComputerTools({
      ...stub,
      computer: {
        available: () => true,
        list: async () => ({ ok: true, text: 'apps' }),
        observe: async () => ({ ok: true, text: 'tree' }),
        act: async () => ({ ok: true, text: 'ok' })
      }
    })
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['computer_list', 'computer_observe', 'computer_act']
    )
  })
})
