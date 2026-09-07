/** First-class product identities. Entries live under packages/; the kernel stays in src/. */

export const PRODUCT_ROLES = [
  'vavd',
  'vav-desktop',
  'vav-cli',
  'vavc',
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
  talksTo: 'vavd'[]
  hello: ProductHello[]
}

export const PRODUCTS: Record<ProductRole, ProductIdentity> = {
  vavd: {
    name: '@21stware/vavd',
    role: 'vavd',
    dir: 'packages/vavd',
    kind: 'service',
    sources: ['packages/vavd/src/vavd.ts'],
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
    talksTo: ['vavd'],
    hello: ['phone', 'daemon']
  },
  'vav-cli': {
    name: '@21stware/vav-cli',
    role: 'vav-cli',
    dir: 'packages/vav-cli',
    kind: 'cli',
    sources: ['packages/vav-cli/src/vavcli.ts'],
    talksTo: ['vavd'],
    hello: ['phone', 'daemon']
  },
  vavc: {
    name: '@21stware/vavc',
    role: 'vavc',
    dir: 'packages/vavc',
    kind: 'cli',
    sources: ['packages/vavc/src/vavc.ts'],
    talksTo: ['vavd'],
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
    talksTo: ['vavd'],
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
    talksTo: ['vavd'],
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
    talksTo: ['vavd'],
    hello: ['phone', 'daemon']
  }
}
