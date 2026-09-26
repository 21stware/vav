import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = join(import.meta.dirname, '../..')

/** Feature branches the product matrix must keep under e2e. */
const REQUIRED = {
  '列表与资源管理': [
    'e2e/specs/sessions.spec.ts',
    'e2e/specs/sidebar-menu.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
  ],
  'agent 输入与对话': [
    'e2e/specs/send.spec.ts',
    'e2e/specs/stream.spec.ts',
    'e2e/specs/transcript.spec.ts',
    'e2e/specs/empty.spec.ts',
    'e2e/specs/change-review.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts'
  ],
  '工作区功能': [
    'e2e/specs/workspace.spec.ts',
    'e2e/specs/workdir.spec.ts',
    'e2e/specs/app-column-context.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
  ],
  '文件查看与选择对话': [
    'e2e/specs/files-preview.spec.ts',
    'e2e/specs/app-column-context.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
    'src/web-ui/phoneVav.test.ts',
    'src/web-ui/phoneDaemon.test.ts',
    'src/main/remote/dirBrowse.test.ts',
    'src/main/daemon/DaemonServer.test.ts',
    'src/main/daemon/vavServerProcess.test.ts',
    'src/main/host/localShellHost.test.ts',
    'src/shared/clipLayout.test.ts',
    'src/main/store/conversationHostBind.test.ts'
  ],
  '远程连接': [
    'e2e/specs/remote-daemon.spec.ts',
    'e2e/specs/remote-control.spec.ts',
  ],
  'terminal 服务': [
    'e2e/specs/chrome.spec.ts',
    'e2e/specs/remote-daemon.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
    'src/main/daemon/vavServerWebUi.browser.test.ts'
  ],
  '配置': [
    'e2e/specs/settings.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
    'e2e/chromeUi.ts'
  ],
  '产品矩阵行为覆盖': [
    'src/shared/productSplit.test.ts',
    'src/shared/productCatalog.ts'
  ],
  '两产品工作区': [
    'src/shared/productCatalog.ts',
    'src/shared/productSplit.test.ts',
    'packages/vav-server/package.json',
    'packages/vav-server/product.json',
    'packages/vav-desktop/package.json',
    'packages/vav-desktop/product.json',
    'scripts/sync-product-identities.mjs'
  ],
  'vav-desktop 产品包': [
    'packages/vav-desktop/package.json',
    'packages/vav-desktop/product.json',
    'packages/vav-desktop/electron-builder.json',
    'scripts/pack-vav-desktop.mjs'
  ],
  '桌面本机=远程': [
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/empty.spec.ts',
    'e2e/specs/settings.spec.ts',
    'e2e/specs/change-review.spec.ts',
    'e2e/specs/remote-daemon.spec.ts',
    'e2e/specs/send.spec.ts',
    'e2e/specs/workspace.spec.ts',
    'e2e/specs/chrome.spec.ts',
    'e2e/specs/attention.spec.ts',
    'e2e/specs/actions.spec.ts',
    'e2e/specs/rich.spec.ts',
    'e2e/specs/swarm.spec.ts',
    'e2e/specs/boot.spec.ts',
    'e2e/specs/acp-live.spec.ts',
    'e2e/specs/acp.spec.ts',
    'e2e/specs/acp-grok.spec.ts',
    'e2e/specs/acp-model.spec.ts',
    'e2e/specs/acp-goal.spec.ts',
    'e2e/specs/usage.spec.ts',
    'e2e/specs/plan-accept.spec.ts',
    'e2e/specs/network-retry.spec.ts',
    'e2e/specs/screenshot.spec.ts',
    'e2e/launch.ts'
  ],
  'Loopback web UI': [
    'e2e/specs/phone-ui.spec.ts',
    'e2e/chromeUi.ts',
    'src/main/daemon/vavServerWebUi.browser.test.ts',
    'src/main/daemon/webClients.test.ts',
    'src/web-ui/phoneVav.test.ts',
    'src/main/daemon/DaemonServer.test.ts',
    'src/shared/remoteDesktop.test.ts'
  ],
} as const

const BEHAVIOR = {
  '列表与资源管理': {
    file: 'e2e/specs/sidebar-menu.spec.ts',
    needles: ['Pin', 'Archive', 'Rename', 'Delete', 'launchWorkbench']
  },
  'agent 输入与对话': {
    file: 'e2e/specs/send.spec.ts',
    needles: ['composer-send', 'e2e stub reply', 'launchWorkbench']
  },
  '工作区功能': {
    file: 'e2e/specs/workspace.spec.ts',
    needles: ['files-new-file', 'hello.md', 'launchWorkbench', 'git-subtabs', 'segment-commits']
  },
  '文件查看与选择对话': { file: 'e2e/specs/files-preview.spec.ts', needles: ['file-preview', 'hello.md', 'launchWorkbench'] },
  '右侧应用列与 Agent 上下文': {
    file: 'e2e/specs/app-column-context.spec.ts',
    needles: [
      'applications-object-detail',
      'comment-card',
      'data-file-workspace',
      'td[data-block-id]',
      'peekContext',
      'createDataFromFile',
      'createKnowledgeNote',
      'knowledge-object-row',
      'data-object-row',
      'openInApp',
      'insertAgentPrompt',
      'app-mode-tabs',
      'launchWorkbench'
    ]
  },
  'terminal 服务': { file: 'e2e/specs/chrome.spec.ts', needles: ['terminal-panel', 'launchWorkbench'] },
  'Chrome / web UI': {
    file: 'e2e/specs/phone-ui.spec.ts',
    needles: [
      'composer-send',
      'e2e stub reply',
      'phone-ui-note.md',
      'new-bash',
      'terminal-panel',
      'pty.list',
      'vav-phone-term',
      'xterm-helper-textarea',
      'inline-review',
      'existing.ts',
      'assertDesktopSettingsOverlay',
      'assertChromeWanPairRejected',
      'assertGitAndPluginsTray',
      'assertFilePreview',
      'assertFilesRenameAndTrash',
      'assertSessionListActions',
      'assertNewSessionRow',
      'assertHostRotateOffer'
    ]
  },
  'Chrome / web Settings + Git': {
    file: 'e2e/chromeUi.ts',
    needles: [
      'DESKTOP_SETTINGS_NAV',
      'phone-settings',
      'settings-nav-',
      'providers-list',
      'connect-panel-incoming',
      'settings-log-retention',
      'logRetentionDays',
      'git.init',
      'segment-git',
      'git-panel',
      'plugins-tray',
      'file-preview-name',
      'vav-phone-preview-body',
      'openFilePreview',
      'vav-dom-menu',
      'Chrome renamed',
      'new-session',
      'availableFonts',
      'accounts.createDraft',
      'rotateOffer',
      'assertHostRotateOffer',
      'assertChromeWanPairRejected',
      'files.rename',
      'files.trash'
    ]
  },
  'Chrome terminal': {
    file: 'src/main/daemon/vavServerWebUi.browser.test.ts',
    needles: ['new-bash', 'terminal-panel', 'pty.list']
  },
  'first-run 本机=远程': {
    file: 'e2e/specs/empty.spec.ts',
    needles: ['launchWorkbench', 'Configure an API Key', 'empty-open-settings', 'empty-in']
  },
  '桌面截图本机=远程': {
    file: 'e2e/specs/screenshot.spec.ts',
    needles: [
      'launchWorkbench',
      'seedVavKeyAccount',
      'composer-screenshot',
      'composer-screenshot-menu',
      'screenshot-crop',
      'Hide window, then capture'
    ]
  },
  '配置': {
    file: 'e2e/specs/settings.spec.ts',
    needles: [
      'settings is a separate window',
      'Providers',
      'accounts catalog',
      'createDraft',
      'spawned vav-server host settings',
      'githubTrayEnabled',
      'defaultApprovalMode',
      'setApiKey',
      'sk-e2e-vav-server-key',
      'logRetentionDays',
      'launchWorkbench',
      'settings-reduce-motion',
      'settings-screenshot-keep-front',
      'screenshotKeepWindowFront',
      'segment-mod-enter',
      'settings-auto-update-policy',
      'settings-about-update-checking',
      'settings-about-update-cancel'
    ]
  },
  '桌面本机=远程': {
    file: 'e2e/specs/desktop-vav-server-matrix.spec.ts',
    needles: [
      'spawnVavServer: true',
      'session-row',
      'setApprovalMode',
      'composer-send',
      'e2e stub reply',
      'hello.md',
      'file-preview',
      'hello from e2e',
      'files-new-file',
      'note.md',
      'segment-git',
      'plugins-tray',
      'readVavServerConversation',
      'new-bash',
      'terminal-panel',
      'pty.list'
    ]
  }
} as const

describe('e2e feature coverage', () => {
  it('keeps a spec for every product-matrix branch', () => {
    for (const [branch, files] of Object.entries(REQUIRED)) {
      for (const file of files) {
        assert.ok(existsSync(join(root, file)), `${branch} missing ${file}`)
      }
    }
  })

  it('keeps behavioral assertions on every named feature branch', () => {
    for (const [branch, spec] of Object.entries(BEHAVIOR)) {
      const body = readFileSync(join(root, spec.file), 'utf8')
      for (const needle of spec.needles) {
        assert.match(body, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${branch} missing ${needle}`)
      }
    }
  })

  it('keeps Chrome Settings accounts on the same daemon catalog as vavBoard', () => {
    const web = readFileSync(join(root, 'src/main/daemon/vavServerWebUi.browser.test.ts'), 'utf8')
    const phone = readFileSync(join(root, 'src/web-ui/phoneVav.ts'), 'utf8')
    assert.match(web, /openSettings\('agents'\)/)
    assert.match(web, /accounts\.createDraft/)
    assert.match(web, /accounts\.getPage/)
    assert.match(web, /accounts\.beginOAuth/)
    assert.match(web, /openSettings\('connect'\)/)
    assert.match(web, /new-bash/)
    assert.match(web, /terminal-panel/)
    assert.match(web, /pty\.list/)
    assert.match(web, /files-new-file/)
    assert.match(web, /web-note.md/)
    assert.match(web, /connect-pairing-line/)
    assert.match(web, /hosts\.rotateOffer/)
    assert.match(web, /hosts\.incoming/)
    assert.match(web, /settings-rotate-offer/)
    assert.match(web, /changeSets\.seedReview/)
    assert.match(web, /inline-review/)
    assert.match(web, /settings-reduce-motion/)
    assert.match(web, /availableFonts/)
    assert.match(web, /hosts\.pair/)
    assert.match(phone, /accounts\.createDraft/)
    assert.match(phone, /accounts\.beginOAuth/)
    assert.match(phone, /accounts\.cancelOAuth/)
    assert.match(phone, /accounts\.signOut/)
    assert.match(phone, /pairingSecretFromPaste/)
    assert.match(phone, /pairingPasteIsLoopback/)
    assert.match(phone, /pairingPasteIsLocalHost/)
    assert.match(phone, /fetchLoopbackDiscover/)
    assert.match(phone, /availableFonts: async \(\) => browserCodeFonts/)
    assert.match(phone, /pickBrowserColor/)
    assert.match(phone, /importBrowserSurfacePattern/)
    assert.match(phone, /assessSurfaceRgba/)
    assert.match(phone, /Chrome can pair this machine or a private LAN host/)
    const accountsIpc = readFileSync(join(root, 'src/main/ipc/registerAccountsIpc.ts'), 'utf8')
    assert.match(accountsIpc, /accounts\.beginOAuth/)
    assert.match(accountsIpc, /accounts\.cancelOAuth/)
    assert.match(accountsIpc, /accounts\.signOut/)
    assert.match(accountsIpc, /if \(client\) return client\.request\('accounts\.beginOAuth'/)
    assert.match(accountsIpc, /publishSettings/)
    const settingsCatalog = readFileSync(join(root, 'src/main/daemon/settingsCatalog.ts'), 'utf8')
    assert.match(settingsCatalog, /vavAccountKeyPresent/)
    assert.match(settingsCatalog, /hasVavKey/)
    assert.match(phone, /vav:phone-open-settings/)
    assert.match(phone, /settings\.get/)
    assert.match(phone, /settings\.update/)
    assert.match(phone, /settings\.setSecret/)
    const settingsWindow = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/SettingsWindow.tsx'), 'utf8')
    assert.match(settingsWindow, /if \(!useSessionStore.getState\(\)\.ready\)/)
    const review = readFileSync(join(root, 'e2e/specs/change-review.spec.ts'), 'utf8')
    assert.match(review, /launchWorkbench/)
    assert.match(review, /seedReview/)
    const session = readFileSync(join(root, 'e2e/specs/session.spec.ts'), 'utf8')
    assert.match(session, /launchWorkbench/)
    assert.match(session, /home-page/)
    assert.match(session, /sidebar-services/)
    assert.match(session, /sidebar-history/)
    assert.match(session, /app-mode-tabs/)
    assert.match(session, /settings-nav-connect/)
    assert.match(session, /file-source-select/)
    assert.match(session, /app-back/)
    const appColumn = readFileSync(join(root, 'e2e/specs/app-column-context.spec.ts'), 'utf8')
    assert.match(appColumn, /launchWorkbench/)
    assert.match(appColumn, /comment-card/)
    assert.match(appColumn, /data-testid="app-context"/)
    assert.match(appColumn, /data-file-workspace/)
    assert.match(appColumn, /E2E_SESSION_ID/)
    assert.match(appColumn, /peekContext/)
    assert.match(appColumn, /appColumnFocus/)
    assert.match(appColumn, /openInApp/)
    assert.match(appColumn, /insertAgentPrompt/)
    const boot = readFileSync(join(root, 'e2e/specs/boot.spec.ts'), 'utf8')
    assert.match(boot, /launchWorkbench/)
    const sidebarMenu = readFileSync(join(root, 'e2e/specs/sidebar-menu.spec.ts'), 'utf8')
    const shortcuts = readFileSync(join(root, 'e2e/specs/shortcuts.spec.ts'), 'utf8')
    assert.match(sidebarMenu, /launchWorkbench/)
    assert.match(shortcuts, /launchWorkbench/)
    assert.match(shortcuts, /Meta\+t/)
    const attention = readFileSync(join(root, 'e2e/specs/attention.spec.ts'), 'utf8')
    const actions = readFileSync(join(root, 'e2e/specs/actions.spec.ts'), 'utf8')
    const rich = readFileSync(join(root, 'e2e/specs/rich.spec.ts'), 'utf8')
    const swarm = readFileSync(join(root, 'e2e/specs/swarm.spec.ts'), 'utf8')
    assert.match(attention, /launchWorkbench/)
    assert.match(attention, /resultUnseen/)
    assert.match(actions, /launchWorkbench/)
    assert.match(actions, /message-regenerate/)
    assert.match(rich, /launchWorkbench/)
    assert.match(swarm, /launchWorkbench/)
    assert.match(swarm, /swarmMode: true/)
    const acpLive = readFileSync(join(root, 'e2e/specs/acp-live.spec.ts'), 'utf8')
    const acpChrome = readFileSync(join(root, 'e2e/specs/acp.spec.ts'), 'utf8')
    const launch = readFileSync(join(root, 'e2e/launch.ts'), 'utf8')
    assert.match(acpLive, /launchWorkbench/)
    assert.match(acpLive, /liveAcp: true/)
    assert.match(acpChrome, /launchWorkbench/)
    const screenshot = readFileSync(join(root, 'e2e/specs/screenshot.spec.ts'), 'utf8')
    assert.match(screenshot, /launchWorkbench/)
    assert.match(screenshot, /composer-screenshot/)
    for (const file of [
      'e2e/specs/acp-grok.spec.ts',
      'e2e/specs/acp-model.spec.ts',
      'e2e/specs/acp-goal.spec.ts',
      'e2e/specs/usage.spec.ts',
      'e2e/specs/plan-accept.spec.ts',
      'e2e/specs/network-retry.spec.ts'
    ]) {
      assert.match(readFileSync(join(root, file), 'utf8'), /launchWorkbench/)
    }
    assert.match(launch, /cliAgents: settings.cliAgents/)
    const daemonReview = readFileSync(join(root, 'src/main/daemon/DaemonServer.ts'), 'utf8')
    const desktopReview = readFileSync(join(root, 'packages/vav-desktop/src/main/index.ts'), 'utf8')
    assert.match(daemonReview, /case 'changeSets\.seedReview'/)
    assert.match(desktopReview, /changeSets\.seedReview/)
    assert.match(desktopReview, /projectSmokeChangeReview/)
    assert.match(desktopReview, /E2E_ACP_MODEL_LOG/)
    assert.match(desktopReview, /refreshHostSession/)
    assert.match(phone, /host\.rotateOffer/)
    assert.match(phone, /host\.incoming/)
    assert.match(phone, /remoteControlEnabled: true/)
  })

  it('keeps Chrome file-preview sessions on the daemon plane', () => {
    const phone = readFileSync(join(root, 'src/web-ui/phoneVav.ts'), 'utf8')
    const daemon = readFileSync(join(root, 'src/main/daemon/DaemonServer.ts'), 'utf8')
    const desktop = readFileSync(join(root, 'src/main/ipc/registerFileSessionsIpc.ts'), 'utf8')
    assert.match(phone, /fileSessions\.open/)
    assert.match(daemon, /case 'fileSessions\.open'/)
    assert.match(daemon, /fileSessions\?: DaemonFileSessionCatalog/)
    assert.match(desktop, /fileSessions\.open/)
    assert.match(desktop, /host\.remote/)
    assert.match(desktop, /remoteOnly/)
    assert.match(desktop, /rememberRemoteSessions/)
    const remoteDaemon = readFileSync(join(root, 'e2e/specs/remote-daemon.spec.ts'), 'utf8')
    assert.match(remoteDaemon, /file-source-select/)
    assert.match(remoteDaemon, /remote-folder-entry-remote-only\.md/)
    const timers = readFileSync(join(root, 'src/main/ipc/registerTimerIpc.ts'), 'utf8')
    assert.match(timers, /timers\.listJobs/)
    assert.match(timers, /host\.remote/)
    const plugins = readFileSync(join(root, 'src/main/ipc/registerPluginIpc.ts'), 'utf8')
    assert.match(plugins, /plugins\.list/)
    assert.match(plugins, /unwrapPluginMutation/)
    const connectors = readFileSync(join(root, 'src/main/ipc/registerConnectorIpc.ts'), 'utf8')
    assert.match(connectors, /connectors\.catalog/)
    assert.match(connectors, /host\.remote/)
    assert.match(phone, /unwrapPluginMutation/)
    assert.match(phone, /encoding: 'utf8'/)
    assert.match(phone, /fs\.rename/)
    assert.match(phone, /fs\.unlink/)
    assert.match(phone, /fs\.reveal/)
    assert.match(phone, /fs\.openPath/)
    assert.match(phone, /fs\.getInfo/)
    assert.match(phone, /fs\.copyAsFile/)
    assert.match(phone, /inspect: async/)
    assert.match(phone, /fs\.stat/)
    assert.match(phone, /vav:phone-open-file-preview/)
    assert.match(phone, /setPreviewCloseGuard/)
    assert.match(phone, /forcePreviewClose/)
    const phoneApp = readFileSync(join(root, 'src/web-ui/PhoneApp.tsx'), 'utf8')
    assert.match(phoneApp, /vav:phone-open-file-preview/)
    assert.match(phoneApp, /setFilePreviewOpen\(true\)/)
    assert.match(phone, /fs\.watch/)
    assert.match(phone, /fs\.unwatch/)
    assert.match(phone, /FILE_WATCH_DEBOUNCE_MS/)
    assert.match(phone, /resolvedHostPlatform/)
    assert.match(daemon, /case 'fs\.reveal'/)
    assert.match(daemon, /case 'fs\.openPath'/)
    assert.match(daemon, /case 'fs\.getInfo'/)
    assert.match(daemon, /hostFileSpawn/)
    const desktopMain = readFileSync(join(root, 'packages/vav-desktop/src/main/index.ts'), 'utf8')
    const remoteDesktop = readFileSync(join(root, 'src/shared/remoteDesktop.ts'), 'utf8')
    assert.match(desktopMain, /workspaceHostForConversation/)
    assert.match(desktopMain, /waitForMountedLocalShell/)
    assert.match(desktopMain, /localShellPairing/)
    assert.match(desktopMain, /shouldRestoreInProcessPty/)
    assert.match(desktopMain, /getInfoOnMachine/)
    assert.match(desktopMain, /copyAsFileOnMachine/)
    assert.match(desktopMain, /rememberRemoteFileSessions/)
    assert.match(remoteDesktop, /conversationFromRemoteSession/)
    assert.match(phone, /conversationFromRemoteSession/)
    assert.match(desktopMain, /applyConversationPersist/)
    assert.match(desktopMain, /setShouldPersist/)
    const usage = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/state/sessionUsage.ts'), 'utf8')
    const transcript = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/components/Transcript.tsx'), 'utf8')
    assert.match(usage, /hostHoldsRemoteKeys/)
    assert.match(transcript, /hostHoldsRemoteKeys/)
    assert.match(phone, /clipHash16/)
  })

  it('keeps Chrome conversation mutations on the phone plane', () => {
    const phone = readFileSync(join(root, 'src/web-ui/phoneVav.ts'), 'utf8')
    const proto = readFileSync(join(root, 'src/shared/remoteControl.ts'), 'utf8')
    const desktop = readFileSync(join(root, 'packages/vav-desktop/src/main/index.ts'), 'utf8')
    for (const verb of ['edit', 'fork', 'delete-message', 'leaf', 'duplicate', 'continue']) {
      assert.match(phone, new RegExp(`type: '${verb}'`))
      assert.match(proto, new RegExp(`type: '${verb}'`))
    }
    assert.match(desktop, /tryRemoteFork/)
    assert.match(desktop, /tryRemoteCompact/)
    assert.match(desktop, /forwardDeleteMessage/)
    assert.match(desktop, /forwardDuplicate/)
    assert.match(desktop, /forwardRemove/)
    assert.match(desktop, /forwardPin/)
    assert.match(desktop, /dialControl\(conversation, run\)/)
    assert.match(phone, /changeSets\.get/)
    assert.match(phone, /readClipboardImage/)
    assert.match(phone, /type: 'goal'/)
    assert.match(phone, /type: 'locate'/)
    assert.match(phone, /hosts: \{/)
    assert.match(phone, /host\.pairing/)
    assert.match(phone, /host\.rotateOffer/)
    assert.match(phone, /host\.incoming/)
    assert.match(phone, /listDir:/)
    assert.match(phone, /vav:phone-open-settings/)
    assert.match(phone, /logs\.query/)
    assert.match(phone, /readBinary/)
    assert.match(phone, /accounts\.getPage/)
    assert.match(phone, /accounts\.createVav/)
    assert.match(phone, /accounts\.beginOAuth/)
    assert.match(phone, /turnEventsFromRemoteTurn/)
    const phoneTest = readFileSync(join(root, 'src/web-ui/phoneVav.test.ts'), 'utf8')
    assert.match(phoneTest, /recovery/)
    assert.match(phoneTest, /healing/)
    const remoteDesktop = readFileSync(join(root, 'src/shared/remoteDesktop.ts'), 'utf8')
    assert.match(remoteDesktop, /event\.recovery/)
    assert.match(remoteDesktop, /phase: event\.recovery\.kind/)
    const daemonProto = readFileSync(join(root, 'src/shared/daemonProtocol.ts'), 'utf8')
    assert.match(daemonProto, /accounts\.getPage/)
    assert.match(daemonProto, /accounts\.createDraft/)
    assert.match(daemonProto, /accounts\.beginOAuth/)
    assert.match(daemonProto, /accounts\.cancelOAuth/)
    assert.match(daemonProto, /accounts\.signOut/)
    assert.match(daemonProto, /host\.rotateOffer/)
    assert.match(daemonProto, /host\.incoming/)
    assert.match(daemonProto, /host\.disconnectIncoming/)
    assert.match(daemonProto, /host\.unpairIncoming/)
    assert.match(proto, /type: 'goal'/)
    assert.match(proto, /type: 'locate'/)
  })

})
