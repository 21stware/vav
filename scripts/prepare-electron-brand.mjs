/**
 * `app.setName()` renames the menu bar but not the Dock: macOS reads the Dock
 * tile's tooltip from the running bundle's Info.plist, and in dev that bundle
 * is the stock node_modules/electron/dist/Electron.app.
 *
 * So rebrand the dev bundle itself — rename it, give it its own identifier
 * (LaunchServices keys its cached display name off the identifier, and
 * com.github.Electron is registered system-wide as "Electron"), point path.txt
 * at the new executable, and re-register it. Re-runs whenever Electron or the
 * icon changes; npm install restores the stock bundle, which the path check
 * below detects.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, execSync } from 'node:child_process'

const APP_NAME = 'vav'
const BUNDLE_ID = 'dev.vav.app'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconSrc = join(root, 'build/icon.png')
const distDir = join(root, 'node_modules/electron/dist')
const pathFile = join(root, 'node_modules/electron/path.txt')
const stockApp = join(distDir, 'Electron.app')
const brandedApp = join(distDir, `${APP_NAME}.app`)
const relativeExec = `${APP_NAME}.app/Contents/MacOS/${APP_NAME}`
const stampFile = join(root, 'build/.electron-brand-stamp')

function currentStamp() {
  const version = readFileSync(join(distDir, 'version'), 'utf8').trim()
  const iconMtime = existsSync(iconSrc) ? execSync(`stat -f %m "${iconSrc}"`).toString().trim() : '0'
  return `${version}:${iconMtime}:${BUNDLE_ID}`
}

function isBranded() {
  return (
    existsSync(join(brandedApp, `Contents/MacOS/${APP_NAME}`)) &&
    existsSync(pathFile) &&
    readFileSync(pathFile, 'utf8').trim() === relativeExec
  )
}

function buildIcns(target) {
  const iconset = join(root, 'build', `${APP_NAME}.iconset`)
  execSync(`rm -rf "${iconset}" && mkdir -p "${iconset}"`)

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]
  for (const [size, name] of sizes) {
    execFileSync('sips', ['-z', String(size), String(size), iconSrc, '--out', join(iconset, name)], {
      stdio: 'ignore'
    })
  }

  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', target], { stdio: 'ignore' })
  execSync(`rm -rf "${iconset}"`, { stdio: 'ignore' })
}

function patchInfoPlist(plistPath) {
  const keys = {
    CFBundleName: APP_NAME,
    CFBundleDisplayName: APP_NAME,
    CFBundleExecutable: APP_NAME,
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleIconFile: `${APP_NAME}.icns`
  }
  for (const [key, value] of Object.entries(keys)) {
    // Set fails on absent keys, so fall back to Add.
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], {
        stdio: 'ignore'
      })
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plistPath], {
        stdio: 'ignore'
      })
    }
  }
}

/** Editing a signed bundle invalidates its signature; re-sign ad-hoc so it launches. */
function resign(appPath) {
  try {
    execFileSync('codesign', ['--force', '--sign', '-', appPath], { stdio: 'ignore' })
  } catch {
    // An unsigned dev bundle is still launchable; not worth failing the run.
  }
}

/** Without this the Dock keeps showing the name LaunchServices cached earlier. */
function reregister(appPath) {
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  try {
    execFileSync(lsregister, ['-f', appPath], { stdio: 'ignore' })
  } catch {
    // Only affects how quickly Finder/Dock notice the new name.
  }
}

export function prepareBrandedElectron() {
  if (process.platform !== 'darwin') return

  const stamp = currentStamp()
  if (isBranded() && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) return

  if (!existsSync(brandedApp) && !existsSync(stockApp)) {
    throw new Error('Electron.app not found — run npm install first')
  }
  if (!existsSync(iconSrc)) {
    throw new Error(`Missing ${iconSrc} — run python3 brand/generate.py first`)
  }

  console.log(`[${APP_NAME}] rebranding the dev Electron bundle…`)

  if (!existsSync(brandedApp)) renameSync(stockApp, brandedApp)

  const macos = join(brandedApp, 'Contents/MacOS')
  if (existsSync(join(macos, 'Electron')) && !existsSync(join(macos, APP_NAME))) {
    renameSync(join(macos, 'Electron'), join(macos, APP_NAME))
  }

  buildIcns(join(brandedApp, 'Contents/Resources', `${APP_NAME}.icns`))
  patchInfoPlist(join(brandedApp, 'Contents/Info.plist'))
  writeFileSync(pathFile, relativeExec)
  resign(brandedApp)
  reregister(brandedApp)
  writeFileSync(stampFile, stamp)

  console.log(`[${APP_NAME}] dev bundle is now ${APP_NAME}.app`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareBrandedElectron()
}
