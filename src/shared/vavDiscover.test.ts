import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  VAVD_WEB_DEFAULT_PORT,
  VAVD_WEB_SCAN_LAST,
  buildDiscoverPayload,
  isLoopbackAddress,
  webScanPorts
} from './vavDiscover.ts'

describe('vavDiscover', () => {
  it('treats IPv4 / IPv6 / mapped loopback as local', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true)
    assert.equal(isLoopbackAddress('::1'), true)
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
    assert.equal(isLoopbackAddress('127.9.9.9'), true)
    assert.equal(isLoopbackAddress('localhost'), true)
    assert.equal(isLoopbackAddress('192.168.1.8'), false)
    assert.equal(isLoopbackAddress('10.0.0.2'), false)
    assert.equal(isLoopbackAddress(''), false)
    assert.equal(isLoopbackAddress(null), false)
  })

  it('includes the pairing secret only for loopback clients', () => {
    const secret = () => '0123456789abcdef01234567'
    const local = buildDiscoverPayload({ name: 'office', version: '1.19.0', secret }, true)
    assert.equal(local.app, 'vavd')
    assert.equal(local.proto, 1)
    assert.equal(local.loopback, true)
    assert.equal(local.secret, '0123456789abcdef01234567')
    assert.equal(local.wsPath, '/vav')
    const lan = buildDiscoverPayload({ name: 'office', version: '1.19.0', secret }, false)
    assert.equal(lan.loopback, false)
    assert.equal(lan.secret, undefined)
  })

  it('scans the well-known web range plus hints', () => {
    const ports = webScanPorts([4800, 4752, -1])
    assert.ok(ports.includes(VAVD_WEB_DEFAULT_PORT))
    assert.ok(ports.includes(VAVD_WEB_SCAN_LAST))
    assert.ok(ports.includes(4800))
    assert.ok(!ports.includes(-1))
    assert.equal(ports[0], 4800)
  })
})
