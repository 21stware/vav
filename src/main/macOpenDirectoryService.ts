/**
 * macOS Finder → Services → “Open Directory in VAV”.
 *
 * Electron cannot implement Cocoa NSService providers, so we install a small
 * AppleScript applet into ~/Library/Services that shells out to a helper script.
 * The helper reuses the same `--vav-workdir=` handoff as the `vav <dir>` CLI
 * (second-instance / cold-start openWorkspaceSession).
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { APP_NAME } from './brand'
import { packagedAppBundlePath } from './cli'

/** Bump to reinstall when the service recipe changes. */
const SERVICE_VERSION = 2
const SERVICE_BASENAME = 'Open Directory in VAV'
const MARKER_NAME = `open-dir-service-v${SERVICE_VERSION}`

function supportDir(): string {
  return join(app.getPath('userData'))
}

function markerPath(): string {
  return join(supportDir(), MARKER_NAME)
}

function servicesDir(): string {
  return join(homedir(), 'Library', 'Services')
}

function serviceAppPath(): string {
  return join(servicesDir(), `${SERVICE_BASENAME}.app`)
}

function helperScriptPath(): string {
  return join(supportDir(), 'open-directory-in-vav.sh')
}

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Write the launcher the AppleScript service invokes (one path arg). */
function writeHelperScript(): string {
  mkdirSync(supportDir(), { recursive: true })
  const helper = helperScriptPath()
  let body: string
  if (app.isPackaged && process.platform === 'darwin') {
    const bundle = packagedAppBundlePath()
    body = [
      '#!/bin/sh',
      'set -e',
      'f="$1"',
      '[ -n "$f" ] || exit 0',
      '[ -d "$f" ] || exit 0',
      `exec /usr/bin/open -na ${shSingleQuote(bundle)} --args --vav-workdir="$f"`,
      ''
    ].join('\n')
  } else {
    body = [
      '#!/bin/sh',
      'set -e',
      'f="$1"',
      '[ -n "$f" ] || exit 0',
      '[ -d "$f" ] || exit 0',
      `exec ${shSingleQuote(process.execPath)} ${shSingleQuote(app.getAppPath())} -- --vav-workdir="$f"`,
      ''
    ].join('\n')
  }
  writeFileSync(helper, body, 'utf8')
  chmodSync(helper, 0o755)
  return helper
}

function appleScriptSource(helper: string): string {
  // Pass the helper path as a fixed POSIX string; each Finder item is $1.
  const helperLit = helper.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    'on run {input, parameters}',
    '  repeat with aItem in input',
    '    set p to POSIX path of aItem',
    '    if p ends with "/" then set p to text 1 thru -2 of p',
    '    try',
    `      do shell script quoted form of "${helperLit}" & " " & quoted form of p`,
    '    end try',
    '  end repeat',
    '  return input',
    'end run',
    ''
  ].join('\n')
}

/**
 * Restrict the service to folders and set the Services menu title.
 * osacompile produces a generic applet; we inject NSServices ourselves.
 */
function patchServiceInfoPlist(appPath: string): void {
  const infoPath = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(infoPath)) return

  try {
    const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPath], {
      encoding: 'utf8',
      timeout: 5000
    })
    const info = JSON.parse(json) as Record<string, unknown>
    info.CFBundleName = SERVICE_BASENAME
    info.CFBundleDisplayName = SERVICE_BASENAME
    info.LSUIElement = true
    info.NSServices = [
      {
        NSMenuItem: {
          default: 'Open Directory in VAV',
          zh_CN: '用 VAV 打开目录',
          'zh-Hans': '用 VAV 打开目录'
        },
        NSMessage: 'run',
        NSPortName: APP_NAME,
        NSSendFileTypes: ['public.folder', 'public.directory'],
        NSRequiredContext: {
          NSTextContent: 'FilePath'
        },
        NSTimeout: 30000
      }
    ]
    const tmp = `${infoPath}.json`
    writeFileSync(tmp, JSON.stringify(info), 'utf8')
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', tmp, '-o', infoPath], {
      timeout: 5000
    })
    try {
      rmSync(tmp)
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn('[mac-service] plutil patch failed', err)
  }
}

function flushServicesCache(): void {
  try {
    execFileSync('/System/Library/CoreServices/pbs', ['-flush'], { timeout: 8000 })
  } catch {
    try {
      execFileSync('/usr/bin/killall', ['pbs'], { timeout: 3000 })
    } catch {
      // non-fatal
    }
  }
}

function stampPayload(): string {
  if (app.isPackaged) return `pkg:${packagedAppBundlePath()}`
  return `dev:${process.execPath}|${app.getAppPath()}`
}

/**
 * Install (or refresh) Finder → Services → “Open Directory in VAV”.
 * Idempotent per {@link SERVICE_VERSION}; safe to call on every ready.
 */
export function ensureMacOpenDirectoryService(): void {
  if (process.platform !== 'darwin') return
  try {
    mkdirSync(supportDir(), { recursive: true })
    mkdirSync(servicesDir(), { recursive: true })

    const stamp = stampPayload()
    if (existsSync(markerPath()) && existsSync(serviceAppPath()) && existsSync(helperScriptPath())) {
      try {
        if (readFileSync(markerPath(), 'utf8').trim() === stamp) {
          // Helper may still need a path refresh if only stamp matched.
          return
        }
      } catch {
        // reinstall
      }
    }

    const helper = writeHelperScript()
    const dest = serviceAppPath()
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true })
    }

    execFileSync('/usr/bin/osacompile', ['-o', dest, '-e', appleScriptSource(helper)], {
      timeout: 20000,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    patchServiceInfoPlist(dest)
    flushServicesCache()
    writeFileSync(markerPath(), stamp, 'utf8')
    console.log('[mac-service] installed', dest)
  } catch (err) {
    console.warn('[mac-service] install failed', err)
  }
}
