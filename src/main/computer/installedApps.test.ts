import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { scanInstalledDesktopApps } from './installedApps.ts'

describe('scanInstalledDesktopApps', () => {
  it('reads .app folders and XML Info.plist name / bundle id', () => {
    const root = join(tmpdir(), `vav-apps-${process.pid}-${Date.now()}`)
    const app = join(root, 'Calendar.app', 'Contents')
    mkdirSync(app, { recursive: true })
    writeFileSync(
      join(app, 'Info.plist'),
      `<?xml version="1.0"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Calendar</string>
  <key>CFBundleIdentifier</key><string>com.apple.iCal</string>
</dict></plist>
`
    )
    mkdirSync(join(root, 'Notes.app'), { recursive: true })
    const apps = scanInstalledDesktopApps([root])
    assert.deepEqual(
      apps.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: 'Calendar', bundleId: 'com.apple.iCal', pid: null },
        { name: 'Notes', bundleId: null, pid: null }
      ]
    )
  })

  it('finds real macOS system apps when those folders exist', () => {
    if (process.platform !== 'darwin') return
    const apps = scanInstalledDesktopApps()
    const names = apps.map((app) => app.name.toLowerCase())
    const hit = names.some(
      (name) =>
        name.includes('calendar') ||
        name.includes('日历') ||
        name.includes('safari') ||
        name.includes('calculator') ||
        name.includes('计算器')
    )
    assert.ok(hit, `expected a system app in ${names.slice(0, 16).join(', ')}`)
  })
})
