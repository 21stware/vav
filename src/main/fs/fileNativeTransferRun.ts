import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  copyFilesAppleScript,
  copyFilesPowerShell,
  getInfoAppleScript,
  propertiesPowerShell
} from './fileNativeTransfer.ts'

const execFileAsync = promisify(execFile)

function unsupported(action: string): Error {
  return new Error(`${action} is only available on macOS and Windows`)
}

/** Put real file URLs on the OS clipboard (Finder Copy / Explorer Copy). */
export async function runCopyPathsToClipboard(
  paths: string[],
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (paths.length === 0) throw new Error('no paths')
  if (platform === 'darwin') {
    await execFileAsync('osascript', ['-e', copyFilesAppleScript(paths)], { timeout: 4000 })
    return
  }
  if (platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', copyFilesPowerShell(paths)],
      { timeout: 4000 }
    )
    return
  }
  throw unsupported('Copy file')
}

/** Finder Get Info / Explorer Properties. */
export async function runShowGetInfo(
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (!path) throw new Error('empty path')
  if (platform === 'darwin') {
    await execFileAsync('osascript', ['-e', getInfoAppleScript(path)], { timeout: 4000 })
    return
  }
  if (platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', propertiesPowerShell(path)],
      { timeout: 4000 }
    )
    return
  }
  throw unsupported('Get Info')
}
