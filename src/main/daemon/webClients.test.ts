import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { WEB_UI_HTML, phoneUiDir } from './webUi.ts'

const root = join(import.meta.dirname, '../../..')
const extDir = join(root, 'packages/vav-chrome-extension/extension')
const phoneSrc = join(root, 'packages/vav-chrome-extension/phone-ui')
const iosFrames = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Models.swift'), 'utf8')
const androidFrames = [
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/Models.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/VavRemoteApp.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionsScreen.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionDetailScreen.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SettingsScreen.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/NotificationsScreen.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/WorkspacePicker.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/AgentBlocks.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/AgentMarkdown.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/PairingScreen.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/QrScanner.kt'), 'utf8'),
  readFileSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteImages.kt'), 'utf8')
].join('\n')
const desktopApp = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/App.tsx'), 'utf8')
const desktopRun = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/components/SessionRunPicker.tsx'), 'utf8')
const desktopComposer = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/components/Composer.tsx'), 'utf8')
const phoneMain = readFileSync(join(phoneSrc, 'main.tsx'), 'utf8')
const desktopCss = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/styles/index.css'), 'utf8')

const extension = [
  readFileSync(join(extDir, 'background.js'), 'utf8'),
  readFileSync(join(extDir, 'sidepanel.html'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneTransport.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneDaemon.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneVav.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'PhoneApp.tsx'), 'utf8')
].join('\n')
const web = [
  WEB_UI_HTML,
  readFileSync(join(phoneSrc, 'phoneTransport.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneDaemon.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'phoneVav.ts'), 'utf8'),
  readFileSync(join(phoneSrc, 'PhoneApp.tsx'), 'utf8')
].join('\n')

/**
 * Chrome side panel and the bundled web page must stay the same phone-protocol
 * client. They are shells — turns stay in vav-server.
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
    for (const src of [extension, web]) {
      assert.match(src, /type:\s*['"]browse['"]/)
      assert.match(src, /files:\s*true/)
      assert.match(src, /role:\s*['"]daemon['"]/)
      assert.match(src, /git\.status/)
      assert.match(src, /plugins\.list/)
      assert.match(src, /github\.listPulls/)
      assert.match(src, /timers\.listJobs/)
      assert.match(src, /connectors\.beginLogin/)
    }
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
    assert.match(phoneMain, /styles\/index\.css/)
    assert.match(desktopCss, /filePreview\.css/)
    const css = readFileSync(join(dir, 'phone.css'), 'utf8')
    assert.match(css, /workspace-view/)
    assert.match(css, /preview-right/)
    assert.match(css, /workspace-view-agent/)
    assert.match(css, /composer-box/)
  })
})

/**
 * iOS VAV Remote is the same client. It omits hello.role; vav-server treats
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
    assert.match(iosFrames, /vavrtp:\/\//)
    assert.match(iosFrames, /parseDaemon/)
    assert.match(iosFrames, /lanHost/)
  })

  it('uses the same desktop run-bar order as the web clients', () => {
    const iosUi = readFileSync(
      join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Views/SessionDetailView.swift'),
      'utf8'
    )
    assert.match(iosUi, /mode · permission/)
    assert.match(iosUi, /thinking · Fast/)
    assert.match(desktopRun, /mode · permission/)
    assert.match(desktopRun, /thinking · Fast/)
  })
})

describe('Android VAV Remote', () => {
  it('speaks the same phone-protocol verbs as iOS', () => {
    assert.match(androidFrames, /"hello"/)
    assert.match(androidFrames, /"send"/)
    assert.match(androidFrames, /"create"/)
    assert.match(androidFrames, /"configure"/)
    assert.match(androidFrames, /"sessions"/)
    assert.match(androidFrames, /"thread"/)
    assert.match(androidFrames, /"reply"/)
    assert.match(androidFrames, /"pin"/)
    assert.match(androidFrames, /"favorite"/)
    assert.match(androidFrames, /"browse"/)
    assert.match(androidFrames, /"workspace"/)
    assert.doesNotMatch(androidFrames, /role.*phone/)
    assert.match(androidFrames, /vavrtp:\/\//)
    assert.match(androidFrames, /parseDaemonPairing/)
    assert.match(androidFrames, /vav-remote:/)
    assert.match(androidFrames, /fun parseRemotePairing/)
    assert.match(androidFrames, /TcmobileSessions/)
    assert.match(androidFrames, /remoteToken/)
    assert.match(androidFrames, /startsWith\("tc"\)/)
    assert.match(androidFrames, /"images"/)
    assert.match(androidFrames, /fun QrScanner/)
    assert.match(androidFrames, /添加照片/)
    assert.match(androidFrames, /SEND_IMAGE_DATA_CAP/)
  })

  it('uses the same desktop run-bar order as iOS', () => {
    assert.match(androidFrames, /mode · permission/)
    assert.match(androidFrames, /thinking · Fast/)
  })

  it('mirrors the iOS remote surfaces', () => {
    assert.match(androidFrames, /RemoteTab.Sessions/)
    assert.match(androidFrames, /RemoteTab.Notifications/)
    assert.match(androidFrames, /RemoteTab.Settings/)
    assert.match(androidFrames, /置顶/)
    assert.match(androidFrames, /收藏/)
    assert.match(androidFrames, /归档/)
    assert.match(androidFrames, /换文件夹/)
    assert.match(androidFrames, /新建临时工作区/)
    assert.match(androidFrames, /这台电脑的默认配置/)
    assert.match(androidFrames, /手机可以做的事/)
    assert.match(androidFrames, /仅电脑/)
    assert.match(androidFrames, /openFromNotification/)
    assert.match(androidFrames, /lastSyncAt/)
    assert.match(androidFrames, /connectIfNeeded/)
    assert.match(androidFrames, /You/)
    assert.match(androidFrames, /Agent/)
    assert.match(androidFrames, /Thinking/)
    assert.match(androidFrames, /需要确认/)
    assert.match(androidFrames, /kind == "awaiting"/)
    assert.match(androidFrames, /"tool" -> ToolRow/)
    assert.match(androidFrames, /"awaiting" -> AwaitingCard/)
    assert.match(androidFrames, /fun AgentMarkdown/)
    assert.match(androidFrames, /withAgentLineBreaks/)
    assert.match(androidFrames, /fun reply/)
    assert.match(androidFrames, /fun suspend/)
    assert.match(androidFrames, /scheduleReconnect/)
    assert.match(androidFrames, /无法新建会话/)
    assert.match(androidFrames, /对话同步超时/)
  })
})
