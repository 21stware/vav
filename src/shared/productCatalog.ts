/** First-class product identities. Entries live under packages/; the kernel stays in src/. */

export const PRODUCT_ROLES = ['vav-server', 'vav-desktop'] as const

export type ProductRole = (typeof PRODUCT_ROLES)[number]
export type ProductKind = 'service' | 'electron'
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
    sources: ['packages/vav-server/src/vav-server.ts', 'src/web-ui/PhoneApp.tsx'],
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
  }
}
