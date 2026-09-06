import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { discoverHostPlugins } from './discover.ts'
import { PluginService } from './PluginService.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'vav-plugins-'))
}

function writeSkill(dir: string, id: string, description: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${id}\ndescription: ${description}\n---\n# ${id}\n`
  )
}

describe('discoverHostPlugins', () => {
  it('reads VAV user skills, MCP, hooks, and plugin packages from ~/.vav', () => {
    const home = tempHome()
    const vav = join(home, '.vav')
    writeSkill(join(vav, 'skills', 'notes'), 'notes', 'Take notes')
    writeFileSync(
      join(vav, 'mcp.json'),
      JSON.stringify({
        mcpServers: { docs: { command: 'npx', args: ['-y', 'docs-mcp'] } }
      })
    )
    writeFileSync(
      join(vav, 'hooks.json'),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }]
        }
      })
    )
    const pack = join(vav, 'plugins', 'office')
    mkdirSync(join(pack, 'skills', 'office'), { recursive: true })
    writeFileSync(
      join(pack, 'plugin.json'),
      JSON.stringify({ name: 'office', description: 'Office pack', version: '1.0.0' })
    )
    writeSkill(join(pack, 'skills', 'office'), 'office', 'Edit office files')

    const snap = discoverHostPlugins('vav', home)
    assert.equal(snap.host, 'vav')
    assert.equal(snap.writable, true)
    assert.equal(snap.hostLabel, 'VAV')
    const skills = snap.plugins.find((plugin) => plugin.id === 'vav:user-skills')
    assert.ok(skills)
    assert.equal(skills.skills[0]?.id, 'notes')
    assert.ok(skills.skills[0]?.path.endsWith('SKILL.md'))
    const mcp = snap.plugins.find((plugin) => plugin.id === 'vav:global-mcp')
    assert.equal(mcp?.mcpServers[0]?.name, 'docs')
    assert.equal(mcp?.mcpServers[0]?.command, 'npx')
    const hooks = snap.plugins.find((plugin) => plugin.id === 'vav:global-hooks')
    assert.equal(hooks?.hooks[0]?.command, 'echo hi')
    const packPlugin = snap.plugins.find((plugin) => plugin.id === 'vav:plugin:office')
    assert.ok(packPlugin)
    assert.equal(packPlugin.name, 'office')
    assert.equal(packPlugin.skills[0]?.name, 'office')
  })

  it('shows Cursor host plugins without VAV virtual entries', () => {
    const home = tempHome()
    const prevCursor = process.env.CURSOR_HOME
    process.env.CURSOR_HOME = join(home, '.cursor')
    try {
      const dir = join(home, '.cursor', 'plugins', 'local', 'review')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: 'review' }))
      writeSkill(join(dir, 'skills', 'review'), 'review', 'Review diffs')
      writeFileSync(
        join(home, '.cursor', 'mcp.json'),
        JSON.stringify({ mcpServers: { gh: { command: 'npx', args: ['-y', 'gh'] } } })
      )
      const snap = discoverHostPlugins('cursor', home)
      assert.equal(snap.host, 'cursor')
      assert.equal(snap.writable, false)
      assert.equal(
        snap.plugins.some((plugin) => plugin.id.startsWith('vav:')),
        false
      )
      assert.ok(snap.plugins.some((plugin) => plugin.name === 'review'))
      const mcp = snap.plugins.find((plugin) => plugin.id === 'cursor:mcp')
      assert.equal(mcp?.mcpServers[0]?.name, 'gh')
      assert.equal(mcp?.readOnly, true)
    } finally {
      if (prevCursor === undefined) delete process.env.CURSOR_HOME
      else process.env.CURSOR_HOME = prevCursor
    }
  })
})

describe('PluginService', () => {
  it('creates and toggles the same files the snapshot lists', () => {
    const home = tempHome()
    const prev = process.env.VAV_HOME
    process.env.VAV_HOME = join(home, '.vav')
    try {
      const service = new PluginService(home)
      const created = service.create('skill', 'Daily notes')
      assert.equal(created.ok, true)
      if (!created.ok) return
      const skill = created.snapshot.plugins
        .find((plugin) => plugin.id === 'vav:user-skills')
        ?.skills.find((row) => row.id === 'daily-notes')
      assert.ok(skill)
      assert.ok(skill.path.includes(`${join('.vav', 'skills', 'daily-notes')}`))

      const mcp = service.create('mcp', 'github')
      assert.equal(mcp.ok, true)
      if (!mcp.ok) return
      assert.ok(
        mcp.snapshot.plugins
          .find((plugin) => plugin.id === 'vav:global-mcp')
          ?.mcpServers.some((row) => row.name === 'github')
      )

      const hook = service.create('hook', 'greet')
      assert.equal(hook.ok, true)
      if (!hook.ok) return
      assert.ok(
        hook.snapshot.plugins
          .find((plugin) => plugin.id === 'vav:global-hooks')
          ?.hooks.some((row) => row.command.includes('greet'))
      )

      const pack = service.create('plugin', 'Demo Pack')
      assert.equal(pack.ok, true)
      if (!pack.ok) return
      const demo = pack.snapshot.plugins.find((plugin) => plugin.id === 'vav:plugin:demo-pack')
      assert.ok(demo)
      const off = service.setEnabled('vav', demo.id, false)
      assert.equal(off.ok, true)
      if (!off.ok) return
      assert.equal(
        off.snapshot.plugins.find((plugin) => plugin.id === demo.id)?.enabled,
        false
      )
      assert.equal(service.enabledSkillEntries().some((row) => row.id === 'demo-pack'), false)

      const on = service.setEnabled('vav', demo.id, true)
      assert.equal(on.ok, true)
      if (on.ok) {
        assert.equal(service.enabledSkillEntries().some((row) => row.id === 'demo-pack'), true)
      }
    } finally {
      if (prev === undefined) delete process.env.VAV_HOME
      else process.env.VAV_HOME = prev
    }
  })

  it('refuses enable/disable for ACP hosts', () => {
    const service = new PluginService(tempHome())
    const result = service.setEnabled('cursor', 'cursor:plugin:x', false)
    assert.equal(result.ok, false)
  })
})
