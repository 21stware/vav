import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { PRODUCT_ROLES, PRODUCTS, type ProductIdentity } from './productCatalog.ts'

const root = join(import.meta.dirname, '../..')

type ProductFile = Pick<ProductIdentity, 'name' | 'role' | 'kind' | 'sources' | 'talksTo' | 'hello'> & {
  version: string
}

describe('seven-product split', () => {
  it('keeps a first-class package for every product', () => {
    assert.equal(PRODUCT_ROLES.length, 7)
    const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version?: string
      workspaces?: string[]
    }
    assert.ok(rootPkg.workspaces?.includes('packages/*'), 'root workspaces must list packages/*')
    const dirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
      .map((entry) => entry.name)
      .sort()
    assert.deepEqual(
      dirs,
      PRODUCT_ROLES.slice().sort(),
      'packages/* must be exactly the seven product identities'
    )
    for (const role of PRODUCT_ROLES) {
      const spec = PRODUCTS[role]
      const pkgPath = join(root, spec.dir, 'package.json')
      assert.ok(existsSync(pkgPath), `${role} missing ${spec.dir}/package.json`)
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string }
      assert.equal(pkg.name, spec.name, `${role} package name`)
      assert.equal(pkg.version, rootPkg.version, `${role} package version`)
      const productPath = join(root, spec.dir, 'product.json')
      assert.ok(existsSync(productPath), `${role} missing ${spec.dir}/product.json`)
      const product = JSON.parse(readFileSync(productPath, 'utf8')) as ProductFile
      assert.equal(product.name, spec.name, `${role} product name`)
      assert.equal(product.role, spec.role, `${role} product role`)
      assert.equal(product.kind, spec.kind, `${role} product kind`)
      assert.equal(product.version, rootPkg.version, `${role} product version`)
      assert.deepEqual(product.sources, spec.sources, `${role} product sources`)
      assert.deepEqual(product.talksTo, spec.talksTo, `${role} talksTo`)
      assert.deepEqual(product.hello, spec.hello, `${role} hello`)
      for (const file of spec.sources) {
        assert.ok(existsSync(join(root, file)), `${role} missing ${file}`)
      }
    }
  })

  it('keeps iOS and Android remotes as matching source trees', () => {
    const swift = readdirSync(join(root, 'packages/vav-ios/VAVRemote/VAVRemote'), { recursive: true })
      .filter((name) => String(name).endsWith('.swift'))
      .map(String)
    const kotlin = readdirSync(join(root, 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote'), {
      recursive: true
    })
      .filter((name) => String(name).endsWith('.kt'))
      .map(String)
    for (const name of [
      'RemoteClient.swift',
      'Models.swift',
      'PairingView.swift',
      'SessionsView.swift',
      'SessionDetailView.swift',
      'SettingsView.swift'
    ]) {
      assert.ok(swift.some((file) => file.endsWith(name)), `iOS missing ${name}`)
    }
    for (const name of [
      'RemoteClient.kt',
      'Models.kt',
      'PairingScreen.kt',
      'SessionsScreen.kt',
      'SessionDetailScreen.kt',
      'SettingsScreen.kt'
    ]) {
      assert.ok(kotlin.some((file) => file.endsWith(name)), `Android missing ${name}`)
    }
    const manifest = readFileSync(
      join(root, 'packages/vav-android/VAVRemote/app/src/main/AndroidManifest.xml'),
      'utf8'
    )
    assert.match(manifest, /android.permission.INTERNET/)
    assert.match(manifest, /android.permission.CAMERA/)
    const chrome = readFileSync(join(root, 'packages/vav-chrome-extension/extension/manifest.json'), 'utf8')
    assert.match(chrome, /"manifest_version": 3/)
    assert.match(chrome, /sidepanel.html/)
  })
})
