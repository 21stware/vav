/** First-class product identities. Entries live under packages/; the kernel stays in src/. */

export const PRODUCT_ROLES = [
  'vav-server',
  'vav-desktop',
  'vav-tui',
  'vav-board',
  'vav-ios',
  'vav-android',
  'vav-chrome-extension'
] as const

export type ProductRole = (typeof PRODUCT_ROLES)[number]
export type ProductKind = 'service' | 'electron' | 'cli' | 'native' | 'extension'
export type ProductHello = 'phone' | 'daemon'

export type ProductIdentity = {
  name: string
  role: ProductRole
  dir: `packages/${ProductRole}`
  kind: ProductKind
  sources: string[]
  talksTo: 'vav-server'[]
  hello: ProductHello[]
}

export const PRODUCTS: Record<ProductRole, ProductIdentity> = {
  'vav-server': {
    name: '@21stware/vav-server',
    role: 'vav-server',
    dir: 'packages/vav-server',
    kind: 'service',
    sources: ['packages/vav-server/src/vav-server.ts'],
    talksTo: [],
    hello: []
  },
  'vav-desktop': {
    name: '@21stware/vav-desktop',
    role: 'vav-desktop',
    dir: 'packages/vav-desktop',
    kind: 'electron',
    sources: [
      'packages/vav-desktop/src/main/index.ts',
      'packages/vav-desktop/src/renderer/src/App.tsx',
      'packages/vav-desktop/electron-builder.json'
    ],
    talksTo: ['vav-server'],
    hello: ['phone', 'daemon']
  },
  'vav-tui': {
    name: '@21stware/vav-tui',
    role: 'vav-tui',
    dir: 'packages/vav-tui',
    kind: 'cli',
    sources: ['packages/vav-tui/src/vav-tui.ts'],
    talksTo: ['vav-server'],
    hello: ['phone', 'daemon']
  },
  'vav-board': {
    name: '@21stware/vav-board',
    role: 'vav-board',
    dir: 'packages/vav-board',
    kind: 'cli',
    sources: ['packages/vav-board/src/vav-board.ts'],
    talksTo: ['vav-server'],
    hello: ['phone', 'daemon']
  },
  'vav-ios': {
    name: '@21stware/vav-ios',
    role: 'vav-ios',
    dir: 'packages/vav-ios',
    kind: 'native',
    sources: [
      'packages/vav-ios/VAVRemote/VAVRemote.xcodeproj/project.pbxproj',
      'packages/vav-ios/VAVRemote/VAVRemote/RemoteClient.swift',
      'packages/vav-ios/VAVRemote/VAVRemote/Views/SessionDetailView.swift'
    ],
    talksTo: ['vav-server'],
    hello: ['phone']
  },
  'vav-android': {
    name: '@21stware/vav-android',
    role: 'vav-android',
    dir: 'packages/vav-android',
    kind: 'native',
    sources: [
      'packages/vav-android/VAVRemote/app/build.gradle.kts',
      'packages/vav-android/VAVRemote/app/src/main/AndroidManifest.xml',
      'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt',
      'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/ui/SessionDetailScreen.kt'
    ],
    talksTo: ['vav-server'],
    hello: ['phone']
  },
  'vav-chrome-extension': {
    name: '@21stware/vav-chrome-extension',
    role: 'vav-chrome-extension',
    dir: 'packages/vav-chrome-extension',
    kind: 'extension',
    sources: [
      'packages/vav-chrome-extension/extension/manifest.json',
      'packages/vav-chrome-extension/extension/sidepanel.html',
      'packages/vav-chrome-extension/phone-ui/PhoneApp.tsx'
    ],
    talksTo: ['vav-server'],
    hello: ['phone', 'daemon']
  }
}
