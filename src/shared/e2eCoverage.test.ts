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
    'e2e/specs/chrome-extension.spec.ts'
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
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
    'e2e/specs/chrome-extension.spec.ts'
  ],
  '文件查看与选择对话': [
    'e2e/specs/files-preview.spec.ts',
    'e2e/specs/desktop-vav-server-matrix.spec.ts',
    'e2e/specs/phone-ui.spec.ts',
    'e2e/specs/chrome-extension.spec.ts',
    'packages/vav-chrome-extension/phone-ui/phoneVav.test.ts',
    'packages/vav-chrome-extension/phone-ui/phoneDaemon.test.ts',
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
    'e2e/specs/phone-remote.spec.ts'
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
    'e2e/specs/chrome-extension.spec.ts',
    'e2e/chromeUi.ts'
  ],
  '产品矩阵行为覆盖': [
    'e2e/specs/product-matrix.spec.ts',
    'src/shared/productSplit.test.ts',
    'src/shared/productCatalog.ts'
  ],
  '七产品工作区': [
    'src/shared/productCatalog.ts',
    'src/shared/productSplit.test.ts',
    'packages/vav-server/package.json',
    'packages/vav-server/product.json',
    'packages/vav-desktop/package.json',
    'packages/vav-desktop/product.json',
    'packages/vav-tui/package.json',
    'packages/vav-tui/product.json',
    'packages/vav-board/package.json',
    'packages/vav-board/product.json',
    'packages/vav-chrome-extension/package.json',
    'packages/vav-chrome-extension/product.json',
    'packages/vav-ios/package.json',
    'packages/vav-ios/product.json',
    'packages/vav-android/package.json',
    'packages/vav-android/product.json',
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
  'vav-board / vav-tui': ['e2e/specs/vav-board-cli.spec.ts', 'packages/vav-tui/src/vavTuiSession.ts', 'src/main/cli/vavTuiSession.test.ts'],
  'Chrome extension': [
    'e2e/specs/phone-ui.spec.ts',
    'e2e/specs/chrome-extension.spec.ts',
    'e2e/chromeUi.ts',
    'src/main/daemon/vavServerExtension.browser.test.ts',
    'src/main/daemon/vavServerWebUi.browser.test.ts',
    'src/main/daemon/webClients.test.ts',
    'packages/vav-chrome-extension/phone-ui/phoneVav.test.ts',
    'src/main/daemon/DaemonServer.test.ts',
    'src/shared/remoteDesktop.test.ts'
  ],
  'Android ≈ iOS': [
    'src/shared/remotePhoneParity.test.ts',
    'src/main/daemon/webClients.test.ts',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/QrScanner.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionDetailScreen.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/AgentMarkdown.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/Models.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SettingsScreen.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteImages.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/TcmobileSessions.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/DiagLog.kt',
    'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteNotifier.kt',
    'scripts/build-tailcat-android.mjs',
    'e2e/specs/phone-remote.spec.ts'
  ]
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
  '远程连接': {
    file: 'e2e/specs/phone-remote.spec.ts',
    needles: [
      'omitRole: true',
      'createSession',
      'sendTurn',
      'browseWorkspace',
      'configureSession',
      'regenerateSession',
      'editSession',
      'replySession',
      'cancelSession',
      'reviewSession',
      'REMOTE_PHONE_CLIENT_TYPES'
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
  'vav-board / vav-tui': {
    file: 'e2e/specs/vav-board-cli.spec.ts',
    needles: [
      'runVavTuiRpc',
      'hello from rpc',
      'runVavTuiLines',
      'hello from repl',
      '--mode text\\|json\\|rpc',
      'stubApprove',
      "type: 'reply'",
      '/edit',
      '/continue',
      '/review',
      'file reveal',
      'file mkdir',
      'file rename',
      'file rm',
      '/file mkdir',
      'file open',
      'file info',
      'hello from tty',
      'vav-tui>',
      'git init',
      '/git',
      'git branch',
      'git checkout',
      'git worktree',
      '/git branch',
      '/plugins',
      '/connectors',
      '/logs',
      '/pin',
      '/star',
      'plugins create',
      '/plugins',
      'e2e-notes',
      'pane spawn',
      'pane write',
      'pane kill',
      'account oauth',
      'account verify',
      'account update',
      'account reveal',
      'account current',
      'account activate',
      '/account reveal',
      'logs record',
      '/logs record',
      'logs tail',
      '/logs tail',
      'settings secret',
      'settings hint',
      'settings reveal-secret',
      '/settings secret',
      'account cancel',
      'connectors auth',
      'connectors status',
      'github actions',
      'github releases',
      'github pages',
      'github pull',
      'github run',
      '/github pull',
      'timers runs',
      'timers sessions',
      'timers remove',
      'timers update',
      'timers get',
      '/timers create',
      '/timers update',
      'connectors act',
      '/connectors act',
      'logs stats',
      'logs export',
      'logs clear',
      'file-session create',
      'file-session rename',
      'file-session activate',
      'file-session delete',
      'file-session force-delete',
      'file-session readonly',
      '/file-session create',
      '/logs stats'
    ]
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
      'settings-about-update-checking'
    ]
  },
  '产品矩阵行为覆盖': {
    file: 'e2e/specs/product-matrix.spec.ts',
    needles: [
      'session',
      'list',
      'browse',
      'file-session',
      'pane',
      'run',
      'compact',
      'configure',
      'regenerate',
      'account',
      'draft',
      'oauth',
      'cancel',
      'plugins',
      'connectors',
      'settings',
      'host',
      'rotate',
      'incoming',
      'review',
      'seed',
      'accept-all',
      'git init'
    ]
  },
  'Chrome MV3 extension': {
    file: 'e2e/specs/chrome-extension.spec.ts',
    needles: [
      'chrome-extension://',
      'sidepanel.html',
      '--load-extension',
      'composer-send',
      'e2e stub reply',
      'ext-note.md',
      'new-bash',
      'terminal-panel',
      'pty.list',
      'vav-phone-term',
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

  it('keeps Android diagnostic logs aligned with iOS', () => {
    const android = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SettingsScreen.kt'),
      'utf8'
    )
    const ios = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Views/SettingsView.swift'), 'utf8')
    const diag = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/DiagLog.kt'),
      'utf8'
    )
    for (const needle of [
      '诊断日志',
      '导出诊断日志',
      '复制日志',
      '清空日志',
      '这台手机可以保存多台电脑',
      '新会话使用电脑上的默认 Agent',
      '工作区、Agent、密钥都在 Host 上',
      '诊断 build 4'
    ]) {
      assert.match(android, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(ios, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
    assert.match(diag, /fun redact/)
    assert.match(diag, /tc…/)
    assert.match(diag, /tokenHint/)
    const iosDetail = readFileSync(
      join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Views/SessionDetailView.swift'),
      'utf8'
    )
    const androidDetail = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionDetailScreen.kt'),
      'utf8'
    )
    for (const needle of [
      '压缩上下文',
      '复制会话',
      '在新会话继续',
      '重新生成',
      '编辑上一条',
      '分叉',
      '设置目标',
      '定位到文件夹',
      '删除上一条',
      '设为当前叶子',
      '拷贝',
      '展开',
      '收起',
      '还没连上电脑',
      '重试连接',
      '正在同步对话',
      '发送失败',
      '对话同步超时。下拉返回再进，或到设置里点立即重连。',
      'Harnessed by VAV',
      '工作区是'
    ]) {
      assert.match(iosDetail, new RegExp(needle))
      assert.match(androidDetail, new RegExp(needle))
    }
    for (const needle of ['turnRecoveryLabel', 'stream-status']) {
      assert.match(iosDetail, new RegExp(needle))
      assert.match(androidDetail, new RegExp(needle))
    }
    for (const needle of ['目标 / 定位临时工作区', '删除消息 / 设为叶子']) {
      assert.match(android, new RegExp(needle))
      assert.match(ios, new RegExp(needle))
    }
    const androidSessions = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionsScreen.kt'),
      'utf8'
    )
    const iosSessions = readFileSync(
      join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Views/SessionsView.swift'),
      'utf8'
    )
    for (const needle of ['正在连接电脑…', '正在同步会话…', '流式中', '无法新建会话']) {
      assert.match(androidSessions, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(iosSessions, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
    const androidModels = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/Models.kt'),
      'utf8'
    )
    const iosModels = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/Models.swift'), 'utf8')
    assert.match(androidModels, /刚刚/)
    assert.match(iosSessions, /刚刚/)
    for (const needle of ['恢复中', '重试中', '重连中', 'turnRecoveryLabel']) {
      assert.match(androidModels, new RegExp(needle))
      assert.match(iosModels, new RegExp(needle))
    }
    const androidClient = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt'),
      'utf8'
    )
    const iosClient = readFileSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote/RemoteClient.swift'), 'utf8')
    for (const needle of ['setViewingConversation', 'failSend', 'suspend', 'scheduleReconnect']) {
      assert.match(androidClient, new RegExp(needle))
      assert.match(iosClient, new RegExp(needle))
    }
  })

  it('keeps Chrome Settings accounts on the same daemon catalog as vavBoard', () => {
    const web = readFileSync(join(root, 'src/main/daemon/vavServerWebUi.browser.test.ts'), 'utf8')
    const phone = readFileSync(join(root, 'packages/vav-chrome-extension/phone-ui/phoneVav.ts'), 'utf8')
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
    assert.match(session, /settings-nav-connect/)
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
    const phone = readFileSync(join(root, 'packages/vav-chrome-extension/phone-ui/phoneVav.ts'), 'utf8')
    const daemon = readFileSync(join(root, 'src/main/daemon/DaemonServer.ts'), 'utf8')
    const desktop = readFileSync(join(root, 'src/main/ipc/registerFileSessionsIpc.ts'), 'utf8')
    assert.match(phone, /fileSessions\.open/)
    assert.match(daemon, /case 'fileSessions\.open'/)
    assert.match(daemon, /fileSessions\?: DaemonFileSessionCatalog/)
    assert.match(desktop, /fileSessions\.open/)
    assert.match(desktop, /host\.remote/)
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
    const phoneApp = readFileSync(join(root, 'packages/vav-chrome-extension/phone-ui/PhoneApp.tsx'), 'utf8')
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
    assert.match(desktopMain, /workspaceHostForConversation/)
    assert.match(desktopMain, /waitForMountedLocalShell/)
    assert.match(desktopMain, /localShellPairing/)
    assert.match(desktopMain, /shouldRestoreInProcessPty/)
    assert.match(desktopMain, /getInfoOnMachine/)
    assert.match(desktopMain, /copyAsFileOnMachine/)
    assert.match(desktopMain, /conversationFromRemoteSession/)
    assert.match(desktopMain, /applyConversationPersist/)
    assert.match(desktopMain, /setShouldPersist/)
    const usage = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/state/sessionUsage.ts'), 'utf8')
    const transcript = readFileSync(join(root, 'packages/vav-desktop/src/renderer/src/components/Transcript.tsx'), 'utf8')
    assert.match(usage, /hostHoldsRemoteKeys/)
    assert.match(transcript, /hostHoldsRemoteKeys/)
    assert.match(phone, /clipHash16/)
  })

  it('keeps Chrome conversation mutations on the phone plane', () => {
    const phone = readFileSync(join(root, 'packages/vav-chrome-extension/phone-ui/phoneVav.ts'), 'utf8')
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
    const phoneTest = readFileSync(join(root, 'packages/vav-chrome-extension/phone-ui/phoneVav.test.ts'), 'utf8')
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

  it('keeps vavBoard file-session and compact on the live CLI surface', () => {
    const vavBoard = readFileSync(join(root, 'packages/vav-board/src/vav-board.ts'), 'utf8')
    const vavTui = readFileSync(join(root, 'packages/vav-tui/src/vav-tui.ts'), 'utf8')
    const e2e = readFileSync(join(root, 'e2e/specs/vav-board-cli.spec.ts'), 'utf8')
    assert.match(vavBoard, /file-session/)
    assert.match(vavBoard, /file reveal/)
    assert.match(vavBoard, /session compact/)
    assert.match(vavBoard, /session regenerate/)
    assert.match(vavBoard, /session goal/)
    assert.match(vavBoard, /session locate/)
    assert.match(vavBoard, /session delete-message/)
    assert.match(vavBoard, /session leaf/)
    assert.match(vavBoard, /account list/)
    assert.match(vavBoard, /account draft/)
    assert.match(vavBoard, /account oauth/)
    assert.match(vavBoard, /account verify/)
    assert.match(vavBoard, /account reveal/)
    assert.match(vavBoard, /account current/)
    assert.match(vavBoard, /updateAccount/)
    assert.match(vavBoard, /revealAccountKey/)
    assert.match(vavBoard, /setCurrentAccount/)
    assert.match(vavBoard, /recordLog/)
    assert.match(vavBoard, /logs record/)
    assert.match(vavBoard, /logs tail/)
    assert.match(vavBoard, /tailLogs/)
    assert.match(vavBoard, /logs.subscribe/)
    assert.match(vavBoard, /settings secret/)
    assert.match(vavBoard, /setHostSecret/)
    assert.match(vavBoard, /hintHostSecret/)
    assert.match(vavBoard, /revealHostSecret/)
    assert.match(vavBoard, /account cancel/)
    assert.match(vavBoard, /account signout/)
    assert.match(vavBoard, /beginAccountOAuth/)
    assert.match(vavBoard, /connectors \[login/)
    assert.match(vavBoard, /connectorAuthStatus/)
    assert.match(vavBoard, /connectorVendorStatus/)
    assert.match(vavBoard, /github actions/)
    assert.match(vavBoard, /listGithubActionsCli/)
    assert.match(vavBoard, /listGithubReleasesCli/)
    assert.match(vavBoard, /getGithubSiteCli/)
    assert.match(vavBoard, /github pull/)
    assert.match(vavBoard, /getGithubPullCli/)
    assert.match(vavBoard, /getGithubActionRunCli/)
    assert.match(vavBoard, /removeTimer/)
    assert.match(vavBoard, /listTimerRuns/)
    assert.match(vavBoard, /listTimerSessions/)
    assert.match(vavBoard, /updateTimer/)
    assert.match(vavBoard, /getTimerForConversation/)
    assert.match(vavBoard, /connectorAct/)
    assert.match(vavBoard, /timers update/)
    assert.match(vavBoard, /timers remove/)
    assert.match(vavBoard, /connectors act/)
    assert.match(vavBoard, /logs stats/)
    assert.match(vavBoard, /clearLogs/)
    assert.match(vavBoard, /exportLogs/)
    assert.match(vavBoard, /gitCreateBranch/)
    assert.match(vavBoard, /gitCheckoutBranch/)
    assert.match(vavBoard, /gitCreateWorktree/)
    assert.match(vavBoard, /git branch/)
    assert.match(vavBoard, /file mkdir/)
    assert.match(vavBoard, /mkdirFile/)
    assert.match(vavBoard, /renameFile/)
    assert.match(vavBoard, /unlinkFile/)
    assert.match(vavBoard, /file-session create/)
    assert.match(vavBoard, /file-session activate/)
    assert.match(vavBoard, /createFileSession/)
    assert.match(vavBoard, /activateFileSession/)
    assert.match(vavBoard, /deleteFileSessions/)
    assert.match(vavTui, /oauth <agent>/)
    assert.match(vavTui, /\/connectors \[list\|auth/)
    assert.match(vavBoard, /vav-board settings/)
    assert.match(vavBoard, /vav-board review seed/)
    assert.match(vavBoard, /host \[info\|pairing\|rotate\|incoming\]/)
    assert.match(vavBoard, /host disconnect/)
    assert.match(vavBoard, /host unpair/)
    assert.match(vavTui, /\/account/)
    assert.match(vavTui, /\/settings/)
    assert.match(vavTui, /draftAccount/)
    assert.match(vavTui, /updateHostSettings/)
    assert.match(e2e, /file-session/)
    assert.match(e2e, /file', 'stat/)
    assert.match(e2e, /session', 'compact/)
    assert.match(e2e, /session', 'regenerate/)
    assert.match(e2e, /account', 'list/)
    assert.match(e2e, /account', 'draft/)
    assert.match(e2e, /account', 'remove/)
    assert.match(e2e, /account', 'cancel/)
    assert.match(e2e, /account', 'oauth/)
    assert.match(e2e, /\/account', 'cancel/)
    assert.match(e2e, /settings', 'set/)
    assert.match(e2e, /review', 'seed/)
    assert.match(e2e, /\/review/)
    assert.match(e2e, /review', 'accept-all/)
    assert.match(e2e, /session', 'delete/)
    assert.match(e2e, /host', 'rotate/)
    assert.match(e2e, /host', 'incoming/)
    assert.match(e2e, /\/files/)
    assert.match(e2e, /\/settings/)
    assert.match(e2e, /\/export/)
    assert.match(e2e, /\/cost/)
    assert.match(e2e, /\/git/)
    assert.match(e2e, /\/init/)
    assert.match(e2e, /\/timers/)
    assert.match(e2e, /--agent', 'cursor/)
    assert.match(e2e, /--mode', 'plan/)
    assert.match(e2e, /\/run-mode/)
    assert.match(e2e, /--mode text\\\|json\\\|rpc/)
    assert.match(e2e, /runVavTuiRpc/)
    assert.match(e2e, /hello from rpc/)
    assert.match(e2e, /runVavTuiLines/)
    assert.match(e2e, /hello from repl/)
    assert.match(e2e, /stubApprove/)
    assert.match(e2e, /\/edit/)
    assert.match(e2e, /\/continue/)
    assert.match(vavBoard, /--mode/)
    assert.match(vavTui, /\/run-mode/)
    assert.match(vavTui, /\/reply/)
    assert.match(vavTui, /\/edit/)
    assert.match(vavTui, /\/continue/)
    assert.match(vavTui, /\/review/)
    assert.match(vavTui, /export \{ runVavTuiLines, runVavTuiRpc, streamTurn \}/)
    const session = readFileSync(join(root, 'packages/vav-tui/src/vavTuiSession.ts'), 'utf8')
    assert.match(session, /export async function runVavTuiRpc/)
    assert.match(session, /export async function runVavTuiLines/)
  })
})
