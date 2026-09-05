import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { WEB_UI_HTML, phoneUiDir } from './webUi.ts'

const extDir = join(import.meta.dirname, '../../../extension')
const iosFrames = readFileSync(
  join(import.meta.dirname, '../../../ios/VAVRemote/VAVRemote/Models.swift'),
  'utf8'
)
const phoneUi = phoneUiDir()
assert.ok(phoneUi, 'shared phone UI directory must exist')
const extension = [
  readFileSync(join(extDir, 'background.js'), 'utf8'),
  readFileSync(join(extDir, 'sidepanel.js'), 'utf8'),
  readFileSync(join(extDir, 'sidepanel.html'), 'utf8'),
  readFileSync(join(extDir, 'lib/discover.js'), 'utf8'),
  readFileSync(join(extDir, 'lib/pairing.js'), 'utf8'),
  readFileSync(join(phoneUi, 'webClient.js'), 'utf8'),
  readFileSync(join(phoneUi, 'shell.js'), 'utf8'),
  readFileSync(join(phoneUi, 'render.js'), 'utf8'),
  readFileSync(join(phoneUi, 'runBar.js'), 'utf8')
].join('\n')
const web = [
  WEB_UI_HTML,
  readFileSync(join(phoneUi, 'webClient.js'), 'utf8'),
  readFileSync(join(phoneUi, 'shell.js'), 'utf8'),
  readFileSync(join(phoneUi, 'render.js'), 'utf8'),
  readFileSync(join(phoneUi, 'runBar.js'), 'utf8')
].join('\n')

/**
 * Chrome side panel and the bundled web page must stay the same phone-protocol
 * client. They are shells — turns stay in vavd.
 */
describe('web and Chrome clients', () => {
  it('speak the same phone-protocol verbs over WebSocket', () => {
    for (const src of [extension, web]) {
      assert.match(src, /role:\s*['"]phone['"]/)
      assert.match(src, /type:\s*['"]hello['"]/)
      assert.match(src, /type:\s*['"]create['"]/)
      assert.match(src, /type:\s*['"]send['"]/)
      assert.match(src, /type:\s*['"]configure['"]/)
      assert.match(src, /approvalMode/)
      assert.match(src, /\bmodel\b/)
      assert.match(src, /ws\.send\(JSON\.stringify/)
      assert.match(src, /\/vav/)
    }
  })

  it('share the desktop session shell (sidebar, agent log, run bar)', () => {
    for (const src of [extension, web]) {
      assert.match(src, /app-shell/)
      assert.match(src, /session-run-controls/)
      assert.match(src, /message-turn/)
      assert.match(src, /message-role/)
      assert.match(src, /thinking-process/)
      assert.match(src, /tool-call/)
      assert.match(src, /composer-box/)
      assert.match(src, /send-button/)
      assert.match(src, /thinkingLevel/)
      assert.match(src, /\bfast\b/)
    }
  })
})

/**
 * iOS VAV Remote is the same client. It omits hello.role; vavd treats
 * non-daemon hello as the control plane (DaemonServer).
 */
describe('iOS VAV Remote', () => {
  it('speaks the same phone-protocol verbs as the web clients', () => {
    assert.match(iosFrames, /"type": "hello"/)
    assert.match(iosFrames, /"type": "send"/)
    assert.match(iosFrames, /"type": "create"/)
    assert.match(iosFrames, /"type": "configure"/)
    assert.match(iosFrames, /"type": "sessions"/)
    assert.match(iosFrames, /"type": "thread"/)
    assert.match(iosFrames, /"type": "reply"/)
    assert.doesNotMatch(iosFrames, /"role": "phone"/)
    assert.match(iosFrames, /vav-daemon:\/\//)
    assert.match(iosFrames, /parseDaemon/)
    assert.match(iosFrames, /lanHost/)
  })

  it('uses the same desktop run-bar order as the web clients', () => {
    const iosUi = readFileSync(
      join(import.meta.dirname, '../../../ios/VAVRemote/VAVRemote/Views/SessionDetailView.swift'),
      'utf8'
    )
    assert.match(iosUi, /mode · permission/)
    assert.match(iosUi, /thinking · Fast/)
    assert.match(readFileSync(join(phoneUi, 'runBar.js'), 'utf8'), /mode · permission/)
  })
})
