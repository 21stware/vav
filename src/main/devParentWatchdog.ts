import { app } from 'electron'
import { isDevRuntime } from './devRuntime'

/**
 * Dev-only: quit when the process that spawned us (electron-vite / `npm run
 * dev`) disappears.
 *
 * Closing a terminal, Cursor killing the shell, or SIGKILL on the parent does
 * not always tear down Electron — especially with the branded `vav.app` binary,
 * whose process name is "VAV Dev". The orphan keeps the userData lock / Dock
 * tile alive and the next `npm run dev` races it → hung UI.
 *
 * Production launches (Finder / Dock) must never use this: their parent can be
 * launchd (ppid 1) by design.
 */
export function installDevParentWatchdog(): void {
  if (!isDevRuntime()) return

  const parentPid = process.ppid
  // Already reparented to init/launchd — nothing to watch.
  if (!parentPid || parentPid <= 1) return

  const timer = setInterval(() => {
    try {
      // Signal 0 = existence check only.
      process.kill(parentPid, 0)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      // ESRCH: gone. EPERM: still exists but inaccessible — keep polling.
      if (code !== 'ESRCH') return
      clearInterval(timer)
      console.warn(
        `[dev] parent process ${parentPid} exited — quitting to avoid orphan VAV`
      )
      // Prefer a clean quit so before-quit flushes stores / kills PTYs.
      try {
        app.quit()
      } catch {
        process.exit(0)
      }
      // If hide-on-close / tray swallows quit, force exit shortly after.
      setTimeout(() => process.exit(0), 1500).unref()
    }
  }, 1500)

  timer.unref()
}
