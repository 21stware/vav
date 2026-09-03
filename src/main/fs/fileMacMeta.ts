import { spawn } from 'node:child_process'

/** JXA that prints the default handler's display name (without `.app`). */
export function defaultAppJxaScript(filePath: string): string {
  const escaped = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `
      ObjC.import('AppKit');
      var url = $.NSURL.fileURLWithPath('${escaped}');
      var appURL = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(url);
      if (!appURL) { ''; }
      else {
        var p = ObjC.unwrap(appURL.path);
        var parts = p.split('/');
        var name = parts[parts.length - 1] || '';
        name.replace(/\\.app$/i, '');
      }
    `
}

export function mdlsRaw(path: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('mdls', ['-raw', '-name', key, path], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`mdls exit ${code}`))
    })
  })
}

/**
 * macOS: display name of the default app that would open this path
 * (e.g. "DiskImageMounter"). Uses JXA + AppKit, capped at 1s.
 */
export function defaultAppDisplayName(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const script = defaultAppJxaScript(filePath)
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', script], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(out.trim() || null))
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(out.trim() || null)
    }, 1000)
  })
}
