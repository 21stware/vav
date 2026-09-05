import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { WEB_UI_HTML, phoneUiDir } from './webUi.ts'

const root = join(import.meta.dirname, '../../..')
const extDir = join(root, 'extension')
const phoneSrc = join(root, 'src/phone-ui')
const iosFrames = readFileSync(join(root, 'ios/VAVRemote/VAVRemote/Models.swift'), 'utf8')
const desktopApp = readFileSync(join(root, 'src/renderer/src/App.tsx'), 'utf8')
const desktopRun = readFileSync(join(root, 'src/renderer/src/components/SessionRunPicker.tsx'), 'utf8')
const desktopComposer = readFileSync(join(root, 'src/renderer/src/components/Composer.tsx'), 'utf8')

const extension = [
  readFileSync(join(extDir, 'background.js'), 'utf8'),
  readFileSync(join(extDir, 'sidepanel.html'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneTransport.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneVav.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'PhoneApp.tsx'), 'utf8')
].join('\n')
const web = [
  WEB_UI_HTML,
  readFileSync(join(phoneSrc, 'phoneTransport.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneVav.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'PhoneApp.tsx'), 'utf8')
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
    }
    assert.match(extension, /chrome\.runtime\.connect/)
    assert.match(web, /WebSocket/)
    assert.match(web, /\/vav/)
  })

  it('mount the desktop session shell (sidebar, agent log, run bar)', () => {
    for (const src of [extension, web]) {
      assert.match(src, /from ['"].*\/App['"]/)
    }
    assert.match(desktopApp, /app-shell/)
    assert.match(desktopApp, /Sidebar/)
    assert.match(desktopApp, /SessionDetail/)
    assert.match(desktopRun, /\[mode · permission\]/)
    assert.match(desktopRun, /\[thinking · Fast\]/)
    assert.match(desktopComposer, /SessionRunPicker/)
    assert.match(desktopComposer, /AgentModelPicker/)
    const dir = phoneUiDir()
    assert.ok(dir, 'built phone UI must exist (run npm run build:phone-ui)')
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
      join(root, 'ios/VAVRemote/VAVRemote/Views/SessionDetailView.swift'),
      'utf8'
    )
    assert.match(iosUi, /mode · permission/)
    assert.match(iosUi, /thinking · Fast/)
    assert.match(desktopRun, /mode · permission/)
    assert.match(desktopRun, /thinking · Fast/)
  })
})
