import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

export interface FileAssociationFormat {
  id: string
  /** Display name */
  label: string
  extensions: string[]
  /** Primary UTI used for Launch Services (macOS) */
  uti: string
  /** P0 = fully supported; P1 = listed but secondary */
  tier: 'p0' | 'p1'
}

export interface FileAssociationStatus {
  id: string
  label: string
  extensions: string[]
  uti: string
  tier: 'p0' | 'p1'
  /** Current default app display name, or null when unset. */
  defaultApp: string | null
  /** Bundle id / ProgId of current default, when known. */
  defaultBundleId: string | null
  isVav: boolean
}

/** Formats from settings-file-associations.rpml. */
export const FILE_ASSOCIATION_FORMATS: FileAssociationFormat[] = [
  { id: 'markdown', label: 'Markdown', extensions: ['.md', '.markdown', '.mdx'], uti: 'net.daringfireball.markdown', tier: 'p0' },
  { id: 'html', label: 'HTML', extensions: ['.html', '.htm', '.xhtml'], uti: 'public.html', tier: 'p0' },
  { id: 'plaintext', label: 'Plain Text', extensions: ['.txt', '.text'], uti: 'public.plain-text', tier: 'p0' },
  { id: 'json', label: 'JSON', extensions: ['.json'], uti: 'public.json', tier: 'p0' },
  { id: 'yaml', label: 'YAML', extensions: ['.yaml', '.yml'], uti: 'public.yaml', tier: 'p0' },
  { id: 'csv', label: 'CSV', extensions: ['.csv', '.tsv'], uti: 'public.comma-separated-values-text', tier: 'p0' },
  { id: 'notebook', label: 'Jupyter Notebook', extensions: ['.ipynb'], uti: 'org.jupyter.ipynb', tier: 'p0' },
  { id: 'swift', label: 'Swift Source', extensions: ['.swift'], uti: 'public.swift-source', tier: 'p0' },
  { id: 'python', label: 'Python Source', extensions: ['.py'], uti: 'public.python-script', tier: 'p0' },
  {
    id: 'javascript',
    label: 'TypeScript / JavaScript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    uti: 'com.netscape.javascript-source',
    tier: 'p0'
  },
  { id: 'pdf', label: 'PDF', extensions: ['.pdf'], uti: 'com.adobe.pdf', tier: 'p1' },
  {
    id: 'docx',
    label: 'Word Document',
    extensions: ['.docx'],
    uti: 'org.openxmlformats.wordprocessingml.document',
    tier: 'p1'
  },
  {
    id: 'xlsx',
    label: 'Excel Spreadsheet',
    extensions: ['.xlsx'],
    uti: 'org.openxmlformats.spreadsheetml.sheet',
    tier: 'p1'
  },
  {
    id: 'pptx',
    label: 'PowerPoint Presentation',
    extensions: ['.pptx'],
    uti: 'org.openxmlformats.presentationml.presentation',
    tier: 'p1'
  },
  {
    id: 'heic',
    label: 'HEIC Image',
    extensions: ['.heic', '.heif'],
    uti: 'public.heic',
    tier: 'p1'
  },
  {
    id: 'zip',
    label: 'ZIP Archive',
    extensions: ['.zip'],
    uti: 'com.pkware.zip-archive',
    /**
     * Viewer for structure preview (not a full Archive Utility replacement).
     * Password / extract-to-disk remain out of scope until explicit product work.
     */
    tier: 'p1'
  }
]

const VAV_BUNDLE_ID = 'com.vav.app'
/** Registered display name / productName used by electron-builder + LaunchAdvancedAssociationUI. */
const VAV_WIN_APP_NAME = 'VAV'

const HELPER_SWIFT = `import Foundation
import CoreServices
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  fputs("usage: vav-ls-helper <uti> get|set [bundleId]\\n", stderr)
  exit(2)
}
let uti = args[1] as CFString
let cmd = args[2]
let bundleId = (args.count > 3 ? args[3] : "${VAV_BUNDLE_ID}") as CFString

switch cmd {
case "get":
  if let handler = LSCopyDefaultRoleHandlerForContentType(uti, .all)?.takeRetainedValue() as String? {
    var name = handler
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: handler) {
      name = FileManager.default.displayName(atPath: url.path)
    }
    print("\\(handler)\\t\\(name)")
  } else {
    print("\\t")
  }
case "set":
  let status = LSSetDefaultRoleHandlerForContentType(uti, .all, bundleId)
  if status != noErr {
    fputs("LSSetDefaultRoleHandlerForContentType failed: \\(status)\\n", stderr)
    exit(1)
  }
default:
  fputs("unknown command\\n", stderr)
  exit(2)
}
`

interface PreviousHandlers {
  [uti: string]: string
}

function emptyStatus(format: FileAssociationFormat): FileAssociationStatus {
  return {
    id: format.id,
    label: format.label,
    extensions: format.extensions,
    uti: format.uti,
    tier: format.tier,
    defaultApp: null,
    defaultBundleId: null,
    isVav: false
  }
}

function isVavWindowsProgId(progId: string): boolean {
  const p = progId.toLowerCase()
  return (
    p.includes('vav') ||
    p.includes('com.vav.app') ||
    p.includes('\\vav.exe') ||
    p.startsWith('applications\\vav')
  )
}

export class FileAssociationService {
  private helperPath: string | null = null
  private previousPath: string

  constructor() {
    this.previousPath = join(app.getPath('userData'), 'file-association-previous.json')
  }

  formats(): FileAssociationFormat[] {
    return FILE_ASSOCIATION_FORMATS
  }

  async listStatus(): Promise<FileAssociationStatus[]> {
    const out: FileAssociationStatus[] = []
    for (const format of FILE_ASSOCIATION_FORMATS) {
      out.push(await this.statusFor(format))
    }
    return out
  }

  async statusFor(format: FileAssociationFormat): Promise<FileAssociationStatus> {
    if (IS_MAC) return this.statusForMac(format)
    if (IS_WIN) return this.statusForWin(format)
    return emptyStatus(format)
  }

  async statusForExtension(ext: string): Promise<FileAssociationStatus | null> {
    const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    const format = FILE_ASSOCIATION_FORMATS.find((f) => f.extensions.includes(normalized))
    if (!format) return null
    return this.statusFor(format)
  }

  async setDefault(formatId: string): Promise<FileAssociationStatus> {
    const format = FILE_ASSOCIATION_FORMATS.find((f) => f.id === formatId)
    if (!format) throw new Error(`Unknown format: ${formatId}`)

    if (IS_MAC) {
      const current = await this.getDefaultMac(format.uti)
      if (current.bundleId && current.bundleId !== VAV_BUNDLE_ID) {
        this.rememberPrevious(format.uti, current.bundleId)
      }
      await this.runHelper(format.uti, 'set', VAV_BUNDLE_ID)
      return this.statusFor(format)
    }

    if (IS_WIN) {
      // Windows 10/11 UserChoice is hash-protected — open the system UI for VAV
      // so the user can confirm defaults (installer already registered ProgIds).
      await this.launchWindowsAssociationUI()
      return this.statusFor(format)
    }

    throw new Error('File associations are only supported on macOS and Windows')
  }

  async unsetDefault(formatId: string): Promise<FileAssociationStatus> {
    const format = FILE_ASSOCIATION_FORMATS.find((f) => f.id === formatId)
    if (!format) throw new Error(`Unknown format: ${formatId}`)

    if (IS_MAC) {
      const previous = this.loadPrevious()[format.uti]
      if (previous) {
        await this.runHelper(format.uti, 'set', previous)
      }
      return this.statusFor(format)
    }

    if (IS_WIN) {
      // Cannot silently clear UserChoice; open the same system UI.
      await this.launchWindowsAssociationUI()
      return this.statusFor(format)
    }

    throw new Error('File associations are only supported on macOS and Windows')
  }

  async registerAll(): Promise<{ updated: string[]; failed: { id: string; error: string }[] }> {
    if (IS_WIN) {
      try {
        await this.launchWindowsAssociationUI()
        return { updated: FILE_ASSOCIATION_FORMATS.filter((f) => f.tier === 'p0').map((f) => f.id), failed: [] }
      } catch (err) {
        return {
          updated: [],
          failed: [{ id: '*', error: (err as Error).message }]
        }
      }
    }

    const updated: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const format of FILE_ASSOCIATION_FORMATS.filter((f) => f.tier === 'p0')) {
      const status = await this.statusFor(format)
      if (status.isVav) continue
      try {
        await this.setDefault(format.id)
        updated.push(format.id)
      } catch (err) {
        failed.push({ id: format.id, error: (err as Error).message })
      }
    }
    return { updated, failed }
  }

  private async statusForMac(format: FileAssociationFormat): Promise<FileAssociationStatus> {
    try {
      const { bundleId, name } = await this.getDefaultMac(format.uti)
      const isVav = !!bundleId && (bundleId === VAV_BUNDLE_ID || bundleId.endsWith('.vav') || name === 'vav' || name === 'VAV')
      return {
        id: format.id,
        label: format.label,
        extensions: format.extensions,
        uti: format.uti,
        tier: format.tier,
        defaultApp: name || null,
        defaultBundleId: bundleId || null,
        isVav
      }
    } catch {
      return emptyStatus(format)
    }
  }

  private async statusForWin(format: FileAssociationFormat): Promise<FileAssociationStatus> {
    try {
      // Prefer the primary extension for status (UserChoice is per-extension).
      const ext = format.extensions[0]
      if (!ext) return emptyStatus(format)
      const { progId, name } = await this.getWindowsDefault(ext)
      const isVav = !!progId && isVavWindowsProgId(progId)
      return {
        id: format.id,
        label: format.label,
        extensions: format.extensions,
        uti: format.uti,
        tier: format.tier,
        defaultApp: name || (progId ? progId : null),
        defaultBundleId: progId || null,
        isVav
      }
    } catch {
      return emptyStatus(format)
    }
  }

  private async getDefaultMac(uti: string): Promise<{ bundleId: string; name: string }> {
    const stdout = await this.runHelper(uti, 'get')
    const line = stdout.trim()
    if (!line || line === '\t') return { bundleId: '', name: '' }
    const tab = line.indexOf('\t')
    if (tab < 0) return { bundleId: line, name: line }
    return { bundleId: line.slice(0, tab), name: line.slice(tab + 1) }
  }

  private async getWindowsDefault(ext: string): Promise<{ progId: string; name: string }> {
    const e = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    const userChoice = await this.regQuery(
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${e}\\UserChoice`,
      'ProgId'
    )
    if (userChoice) {
      return { progId: userChoice, name: await this.windowsProgIdName(userChoice) }
    }
    // Fallback: class default (installer / OpenWithProgids path).
    const classDefault = await this.regQuery(`HKCU\\Software\\Classes\\${e}`, '')
    if (classDefault) {
      return { progId: classDefault, name: await this.windowsProgIdName(classDefault) }
    }
    const hklm = await this.regQuery(`HKLM\\Software\\Classes\\${e}`, '')
    if (hklm) {
      return { progId: hklm, name: await this.windowsProgIdName(hklm) }
    }
    return { progId: '', name: '' }
  }

  private async windowsProgIdName(progId: string): Promise<string> {
    if (isVavWindowsProgId(progId)) return VAV_WIN_APP_NAME
    const friendly =
      (await this.regQuery(`HKCU\\Software\\Classes\\${progId}`, '')) ||
      (await this.regQuery(`HKLM\\Software\\Classes\\${progId}`, ''))
    return friendly || progId
  }

  /**
   * Read a REG_SZ (or default) value. Empty `valueName` queries the key's (Default).
   */
  private async regQuery(key: string, valueName: string): Promise<string | null> {
    try {
      const args = valueName ? ['query', key, '/v', valueName] : ['query', key, '/ve']
      const { stdout } = await execFileAsync('reg', args, {
        timeout: 8_000,
        windowsHide: true
      })
      // REG_SZ lines look like: `    ProgId    REG_SZ    VAV.md`
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        if (!/REG_(SZ|EXPAND_SZ)/i.test(line)) continue
        if (valueName && !line.toLowerCase().includes(valueName.toLowerCase())) continue
        const m = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i)
        const val = m?.[1]?.trim()
        if (val && val !== '(value not set)') return val
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Open Windows' per-app default-programs UI for VAV (hash-safe).
   * Falls back to the generic Default apps Settings page.
   */
  private async launchWindowsAssociationUI(): Promise<void> {
    const ps = `
$ErrorActionPreference = 'Stop'
try {
  $ui = New-Object -ComObject ApplicationAssociationRegistrationUI
  $ui.LaunchAdvancedAssociationUI('${VAV_WIN_APP_NAME}')
} catch {
  Start-Process 'ms-settings:defaultapps'
}
`
    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { timeout: 15_000, windowsHide: true }
      )
    } catch {
      await shell.openExternal('ms-settings:defaultapps')
    }
  }

  private async runHelper(uti: string, cmd: 'get' | 'set', bundleId?: string): Promise<string> {
    const helper = await this.ensureHelper()
    const args = bundleId ? [uti, cmd, bundleId] : [uti, cmd]
    const { stdout } = await execFileAsync(helper, args, { timeout: 15_000 })
    return stdout
  }

  private async ensureHelper(): Promise<string> {
    if (this.helperPath && existsSync(this.helperPath)) return this.helperPath
    const dir = join(app.getPath('userData'), 'bin')
    mkdirSync(dir, { recursive: true })
    const out = join(dir, 'vav-ls-helper')
    const src = join(dir, 'vav-ls-helper.swift')
    const stamp = join(dir, 'vav-ls-helper.stamp')
    const version = '2'
    writeFileSync(src, HELPER_SWIFT, 'utf8')
    if (!existsSync(out) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
      await execFileAsync('swiftc', ['-O', '-o', out, src], { timeout: 120_000 })
      writeFileSync(stamp, version, 'utf8')
    }
    this.helperPath = out
    return out
  }

  private rememberPrevious(uti: string, bundleId: string): void {
    const prev = this.loadPrevious()
    if (!prev[uti]) {
      prev[uti] = bundleId
      mkdirSync(dirname(this.previousPath), { recursive: true })
      writeFileSync(this.previousPath, JSON.stringify(prev, null, 2), 'utf8')
    }
  }

  private loadPrevious(): PreviousHandlers {
    try {
      if (!existsSync(this.previousPath)) return {}
      return JSON.parse(readFileSync(this.previousPath, 'utf8')) as PreviousHandlers
    } catch {
      return {}
    }
  }
}

export function formatIdForPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const ext = name.slice(dot)
  return FILE_ASSOCIATION_FORMATS.find((f) => f.extensions.includes(ext))?.id ?? null
}
