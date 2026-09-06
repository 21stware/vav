import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hookMatcherMatches,
  parseHooksFile,
  parseMcpServersFile,
  parsePluginEnabledMap,
  parseSkillFrontmatter,
  pluginHostKind,
  sanitizePluginName
} from './plugins.ts'

describe('pluginHostKind', () => {
  it('maps empty / vav to the built-in host', () => {
    assert.equal(pluginHostKind(null), 'vav')
    assert.equal(pluginHostKind('vav'), 'vav')
    assert.equal(pluginHostKind('cursor'), 'cursor')
  })
})

describe('parsePluginEnabledMap', () => {
  it('reads enabled flags and defaults missing ids to on', () => {
    const map = parsePluginEnabledMap({ enabled: { docs: true, art: false } })
    assert.equal(map.enabled.docs, true)
    assert.equal(map.enabled.art, false)
  })
})

describe('parseSkillFrontmatter', () => {
  it('reads name and description', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: office\ndescription: Edit Office files\n---\n# Body\n'
    )
    assert.equal(parsed.name, 'office')
    assert.equal(parsed.description, 'Edit Office files')
  })
})

describe('parseMcpServersFile', () => {
  it('accepts the Claude / Cursor object map', () => {
    const servers = parseMcpServersFile(
      {
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }
        }
      },
      '/tmp/mcp.json',
      'vav:global'
    )
    assert.equal(servers.length, 1)
    assert.equal(servers[0].name, 'github')
    assert.equal(servers[0].command, 'npx')
    assert.deepEqual(servers[0].args, ['-y', '@modelcontextprotocol/server-github'])
  })

  it('accepts an ACP-style array', () => {
    const servers = parseMcpServersFile(
      { mcpServers: [{ name: 'fs', command: '/bin/mcp-fs', env: [{ name: 'TOKEN', value: 'x' }] }] },
      '/tmp/mcp.json',
      'vav:global'
    )
    assert.equal(servers[0].env?.TOKEN, 'x')
  })
})

describe('parseHooksFile', () => {
  it('reads Claude-style grouped hooks', () => {
    const hooks = parseHooksFile(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: 'terminal|Bash',
              hooks: [{ type: 'command', command: 'echo pre' }]
            }
          ]
        }
      },
      '/tmp/hooks.json',
      'vav:global'
    )
    assert.equal(hooks.length, 1)
    assert.equal(hooks[0].event, 'PreToolUse')
    assert.equal(hooks[0].command, 'echo pre')
    assert.equal(hookMatcherMatches(hooks[0].matcher, 'terminal'), true)
    assert.equal(hookMatcherMatches(hooks[0].matcher, 'fs_read'), false)
  })
})

describe('sanitizePluginName', () => {
  it('kebab-cases user input', () => {
    assert.equal(sanitizePluginName(' My Skill '), 'my-skill')
    assert.equal(sanitizePluginName('../evil'), 'evil')
  })
})
