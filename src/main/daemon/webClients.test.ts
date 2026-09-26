import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { WEB_UI_HTML, phoneUiDir } from './webUi.ts'

const root = join(import.meta.dirname, '../../..')
const phoneSrc = join(root, 'src/web-ui')
const desktopApp = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/App.tsx'), 'utf8')
const desktopRun = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/components/SessionRunPicker.tsx'), 'utf8')
const desktopComposer = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/components/Composer.tsx'), 'utf8')
const phoneMain = readFileSync(join(phoneSrc, 'main.tsx'), 'utf8')
const desktopCss = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/styles/index.css'), 'utf8')

const web = [
  WEB_UI_HTML,
  readFileSync(join(phoneSrc, 'phoneTransport.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneDaemon.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneVav.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'PhoneApp.tsx'), 'utf8')
].join('\n')

describe('loopback web UI', () => {
  it('speaks phone-protocol verbs over WebSocket', () => {
    assert.match(web, /role:\s*['"]phone['"]/)
    assert.match(web, /type:\s*['"]hello['"]/)
    assert.match(web, /type:\s*['"]create['"]/)
    assert.match(web, /type:\s*['"]send['"]/)
    assert.match(web, /type:\s*['"]configure['"]/)
    assert.match(web, /approvalMode/)
    assert.match(web, /WebSocket/)
    assert.match(web, /\/vav/)
    assert.match(web, /type:\s*['"]browse['"]/)
    assert.match(web, /files:\s*true/)
    assert.match(web, /role:\s*['"]daemon['"]/)
    assert.match(web, /git\.status/)
    assert.match(web, /plugins\.list/)
    assert.match(web, /github\.listPulls/)
    assert.match(web, /timers\.listJobs/)
    assert.match(web, /connectors\.beginLogin/)
  })

  it('mounts the desktop session shell (sidebar, agent log, run bar)', () => {
    assert.match(web, /from ['"].*\/App['"]/)
    assert.match(desktopApp, /app-shell/)
    assert.match(desktopApp, /Sidebar/)
    assert.match(desktopApp, /SessionDetail/)
    assert.match(desktopRun, /\[mode · permission\]/)
    assert.match(desktopRun, /\[thinking · Fast\]/)
    assert.match(desktopComposer, /SessionRunPicker/)
    assert.match(desktopComposer, /AgentModelPicker/)
    const dir = phoneUiDir()
    assert.ok(dir, 'built phone UI must exist (run npm run build:phone-ui)')
    assert.match(phoneMain, /styles\/index\.css/)
    assert.match(desktopCss, /filePreview\.css/)
    const css = readFileSync(join(dir, 'phone.css'), 'utf8')
    assert.match(css, /workspace-view/)
    assert.match(css, /preview-right/)
    assert.match(css, /workspace-view-agent/)
    assert.match(css, /composer-box/)
  })
})
