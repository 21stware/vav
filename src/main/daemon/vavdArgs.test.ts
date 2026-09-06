import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DAEMON_DEFAULT_PORT } from '../../shared/daemonProtocol.ts'
import { DAEMON_LAN_BIND } from './DaemonServer.ts'
import {
  formatListenError,
  formatVavdHelp,
  parsePortFlag,
  parseVavdArgs,
  resolveVavdVersion,
  VAVD_WEB_DEFAULT_PORT
} from './vavdArgs.ts'

describe('parseVavdArgs', () => {
  it('defaults to a LAN serve', () => {
    const parsed = parseVavdArgs([], { home: '/home/x' })
    assert.deepEqual(parsed, {
      kind: 'serve',
      options: {
        stateDir: join('/home/x', '.vavd'),
        name: undefined,
        port: DAEMON_DEFAULT_PORT,
        listen: DAEMON_LAN_BIND,
        webPort: VAVD_WEB_DEFAULT_PORT,
        webListen: '127.0.0.1',
        web: true,
        announce: true,
        quiet: false,
        apiKey: undefined,
        apiEndpoint: undefined
      }
    })
  })

  it('accepts --flag=value and boolean flags', () => {
    const parsed = parseVavdArgs(
      ['--port=0', '--listen=127.0.0.1', '--name', 'Box', '--no-web', '--no-announce', '--quiet'],
      { home: '/tmp' }
    )
    assert.equal(parsed.kind, 'serve')
    if (parsed.kind !== 'serve') return
    assert.equal(parsed.options.port, 0)
    assert.equal(parsed.options.listen, '127.0.0.1')
    assert.equal(parsed.options.name, 'Box')
    assert.equal(parsed.options.web, false)
    assert.equal(parsed.options.announce, false)
    assert.equal(parsed.options.quiet, true)
  })

  it('rejects invalid and missing ports instead of falling back', () => {
    assert.equal(parseVavdArgs(['--port', 'nope']).kind, 'error')
    assert.match((parseVavdArgs(['--port', 'nope']) as { message: string }).message, /--port/)
    assert.equal(parseVavdArgs(['--port']).kind, 'error')
    assert.equal(parseVavdArgs(['--web-port', '70000']).kind, 'error')
    assert.equal(parseVavdArgs(['--port', '-1']).kind, 'error')
    assert.equal(parsePortFlag(undefined, '--port', 4750), 4750)
    assert.equal(parsePortFlag('0', '--port', 4750), 0)
    assert.throws(() => parsePortFlag('abc', '--port', 4750), /integer/)
  })

  it('parses admin verbs with --state after or before the verb', () => {
    const a = parseVavdArgs(['clients'], { home: '/h' })
    assert.equal(a.kind, 'admin')
    if (a.kind !== 'admin') return
    assert.equal(a.command, 'clients')
    assert.equal(a.stateDir, join('/h', '.vavd'))

    const b = parseVavdArgs(['--state', '/tmp/s', 'unpair', 'g1'])
    assert.deepEqual(b, { kind: 'admin', command: 'unpair', id: 'g1', stateDir: '/tmp/s' })

    const c = parseVavdArgs(['disconnect', 'g1', '--state=/tmp/s'])
    assert.deepEqual(c, { kind: 'admin', command: 'disconnect', id: 'g1', stateDir: '/tmp/s' })
  })

  it('rejects unknown flags and leftover commands', () => {
    assert.equal(parseVavdArgs(['--prt', '1']).kind, 'error')
    assert.match((parseVavdArgs(['--prt', '1']) as { message: string }).message, /unknown flag/)
    assert.equal(parseVavdArgs(['serve']).kind, 'error')
    assert.equal(parseVavdArgs(['clients', 'extra']).kind, 'error')
  })

  it('treats help and version as intents', () => {
    assert.equal(parseVavdArgs(['--help']).kind, 'help')
    assert.equal(parseVavdArgs(['-h', '--port', '1']).kind, 'help')
    assert.equal(parseVavdArgs(['--version']).kind, 'version')
    assert.equal(parseVavdArgs(['-V']).kind, 'version')
    assert.match(formatVavdHelp(), /rotate-offer/)
    assert.match(formatVavdHelp(), /--quiet/)
  })

  it('skips the node script prefix when present', () => {
    const parsed = parseVavdArgs(['/usr/bin/node', 'vavd.ts', '--port', '9'], { home: '/h' })
    assert.equal(parsed.kind, 'serve')
    if (parsed.kind !== 'serve') return
    assert.equal(parsed.options.port, 9)
  })
})

describe('formatListenError', () => {
  it('explains address-in-use and bad bind', () => {
    assert.match(formatListenError({ code: 'EADDRINUSE' }, 'vavd', '127.0.0.1', 4750), /already in use/)
    assert.match(formatListenError({ code: 'EADDRNOTAVAIL' }, 'web UI', '9.9.9.9', 1), /cannot bind/)
    assert.equal(formatListenError(new Error('boom'), 'vavd', '0.0.0.0', 1), 'boom')
  })
})

describe('resolveVavdVersion', () => {
  it('prefers npm_package_version then the repo package', () => {
    assert.equal(resolveVavdVersion({ npm_package_version: '9.9.9' }), '9.9.9')
    const fromDisk = resolveVavdVersion({}, join(process.cwd(), 'src/main/daemon/vavd.ts'))
    assert.match(fromDisk, /^\d+\.\d+/)
    assert.notEqual(fromDisk, '9.9.9')
  })

  it('uses the process home default when no home override is given', () => {
    const parsed = parseVavdArgs([])
    assert.equal(parsed.kind, 'serve')
    if (parsed.kind !== 'serve') return
    assert.equal(parsed.options.stateDir, join(homedir(), '.vavd'))
  })
})
