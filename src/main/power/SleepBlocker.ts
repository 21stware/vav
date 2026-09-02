import { powerSaveBlocker } from 'electron'

/**
 * One process-wide idle-sleep assertion, Caffeine-style.
 *
 * `prevent-app-suspension` maps to macOS `PreventUserIdleSystemSleep` (and
 * `ES_SYSTEM_REQUIRED` on Windows): the machine will not idle-sleep, but the
 * display may still turn off. Lid-close needs {@link MacLidSleepGuard}.
 */
export class SleepBlocker {
  private id: number | null = null

  setActive(active: boolean): void {
    if (active) this.acquire()
    else this.release()
  }

  isActive(): boolean {
    return this.id != null && powerSaveBlocker.isStarted(this.id)
  }

  release(): void {
    if (this.id == null) return
    const id = this.id
    this.id = null
    if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id)
  }

  private acquire(): void {
    if (this.id != null && powerSaveBlocker.isStarted(this.id)) return
    this.id = powerSaveBlocker.start('prevent-app-suspension')
  }
}
