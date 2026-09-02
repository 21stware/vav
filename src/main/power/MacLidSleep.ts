import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  grantListedInSudoL,
  parseBatteryStatus,
  parseLowPowerMode,
  parseSleepDisabled,
  sudoersGrantLine,
  SUDOERS_KEEP_AWAKE_FILE,
  type KeepAwakeGrantResult,
  type KeepAwakeSafetyHold,
  keepAwakeSafetyHold
} from '@shared/sleepBlocker'

const execFileAsync = promisify(execFile)

const SUDOERS_PATH = `/etc/sudoers.d/${SUDOERS_KEEP_AWAKE_FILE}`
const SNAPSHOT_TTL_MS = 2_000
const POLL_MS = 60_000
const WATCHDOG_INTERVAL_S = 15

type PowerSnapshot = {
  at: number
  granted: boolean
  lidSleepBlocked: boolean
  onBattery: boolean
  discharging: boolean
  batteryPercent: number
  lowPowerMode: boolean
}

/**
 * macOS lid-close / Apple-menu Sleep via `pmset disablesleep`.
 *
 * Same kernel flag Sleepless uses. Electron's power assertion cannot override
 * clamshell sleep; this can, after a one-time scoped sudoers grant.
 *
 * Safety: agent-work bound (caller), battery floor, Low Power Mode, quit
 * (sync off), and a detached PID watchdog if this process dies.
 */
export class MacLidSleepGuard {
  private desired = false
  private applied = false
  private grantKnownMissing = false
  private snapshot: PowerSnapshot | null = null
  private applyChain: Promise<void> = Promise.resolve()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdog: ChildProcess | null = null
  onChange: (() => void) | null = null

  start(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.refresh()
      this.enqueueApply()
    }, POLL_MS)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.desired = false
    this.releaseSync()
  }

  invalidate(): void {
    this.snapshot = null
  }

  /** Drop cached grant/power reads and retry pmset on the next apply. */
  refresh(): void {
    this.snapshot = null
    this.grantKnownMissing = false
  }

  setDesired(on: boolean): void {
    if (this.desired === on && this.applied === on) return
    this.desired = on
    this.enqueueApply()
  }

  async safetyHold(floorPercent: number): Promise<KeepAwakeSafetyHold> {
    const snap = await this.readSnapshot()
    return keepAwakeSafetyHold({
      onBattery: snap.onBattery,
      discharging: snap.discharging,
      percent: snap.batteryPercent,
      lowPowerMode: snap.lowPowerMode,
      floorPercent
    })
  }

  async granted(): Promise<boolean> {
    return (await this.readSnapshot()).granted
  }

  async lidSleepBlocked(): Promise<boolean> {
    return (await this.readSnapshot()).lidSleepBlocked
  }

  async powerInfo(): Promise<{
    granted: boolean
    lidSleepBlocked: boolean
    onBattery: boolean
    batteryPercent: number
    lowPowerMode: boolean
  }> {
    const snap = await this.readSnapshot()
    return {
      granted: snap.granted,
      lidSleepBlocked: snap.lidSleepBlocked,
      onBattery: snap.onBattery,
      batteryPercent: snap.batteryPercent,
      lowPowerMode: snap.lowPowerMode
    }
  }

  async grant(username: string): Promise<KeepAwakeGrantResult> {
    const line = sudoersGrantLine(username)
    if (!line) return { ok: false, error: 'invalid user' }
    const scriptPath = join(tmpdir(), `vav-keepawake-grant-${randomBytes(8).toString('hex')}.sh`)
    writeFileSync(scriptPath, grantScript(), { mode: 0o700 })
    try {
      const result = await runAdmin(
        `/bin/bash ${asQuotedForm(scriptPath)} ${asQuotedForm(username)}`
      )
      this.refresh()
      return result
    } finally {
      try {
        unlinkSync(scriptPath)
      } catch {
        /* tmp */
      }
    }
  }

  async revoke(): Promise<KeepAwakeGrantResult> {
    this.desired = false
    this.releaseSync()
    const result = await runAdmin(
      `/usr/bin/pmset -a disablesleep 0; /bin/rm -f ${asQuotedForm(SUDOERS_PATH)}`
    )
    this.refresh()
    return result
  }

  /** Best-effort: must finish before the process exits. */
  releaseSync(): void {
    try {
      execFileSync('/usr/bin/sudo', ['-n', '/usr/bin/pmset', '-a', 'disablesleep', '0'], {
        timeout: 4_000,
        stdio: 'ignore'
      })
    } catch {
      /* grant missing or already off */
    }
    this.applied = false
    this.killWatchdog()
  }

  private enqueueApply(): void {
    this.applyChain = this.applyChain.then(() => this.applyNow()).catch(() => undefined)
  }

  private async applyNow(): Promise<void> {
    const on = this.desired
    if (on === this.applied) return
    if (on && this.grantKnownMissing) return
    const result = await this.pmset(on)
    if (result === 'ok') {
      this.grantKnownMissing = false
      this.applied = on
      if (on) this.ensureWatchdog()
      else this.killWatchdog()
      this.invalidate()
      this.onChange?.()
      return
    }
    if (result === 'grantMissing') {
      this.grantKnownMissing = true
      this.applied = false
      this.killWatchdog()
      this.invalidate()
      this.onChange?.()
    }
  }

  private async pmset(on: boolean): Promise<'ok' | 'grantMissing' | 'failed'> {
    try {
      const { stderr } = await execFileAsync(
        '/usr/bin/sudo',
        ['-n', '/usr/bin/pmset', '-a', 'disablesleep', on ? '1' : '0'],
        { timeout: 8_000, encoding: 'utf8' }
      )
      if (isGrantMissing(stderr)) return 'grantMissing'
      return 'ok'
    } catch (err) {
      const stderr = stderrOf(err)
      if (isGrantMissing(stderr)) return 'grantMissing'
      return 'failed'
    }
  }

  private async readSnapshot(): Promise<PowerSnapshot> {
    if (this.snapshot && Date.now() - this.snapshot.at < SNAPSHOT_TTL_MS) {
      return this.snapshot
    }
    const [pmsetG, pmsetBatt, sudoL] = await Promise.all([
      capture('/usr/bin/pmset', ['-g']),
      capture('/usr/bin/pmset', ['-g', 'batt']),
      capture('/usr/bin/sudo', ['-n', '-l'])
    ])
    const batt = parseBatteryStatus(pmsetBatt)
    const snap: PowerSnapshot = {
      at: Date.now(),
      granted: grantListedInSudoL(sudoL),
      lidSleepBlocked: parseSleepDisabled(pmsetG),
      onBattery: batt.onBattery,
      discharging: batt.discharging,
      batteryPercent: batt.percent,
      lowPowerMode: parseLowPowerMode(pmsetG)
    }
    this.snapshot = snap
    return snap
  }

  private ensureWatchdog(): void {
    if (this.watchdog && !this.watchdog.killed) return
    const pid = process.pid
    const child = spawn(
      '/bin/sh',
      [
        '-c',
        `while /bin/kill -0 ${pid} 2>/dev/null; do /bin/sleep ${WATCHDOG_INTERVAL_S}; done; exec /usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0`
      ],
      { detached: true, stdio: 'ignore' }
    )
    child.unref()
    this.watchdog = child
  }

  private killWatchdog(): void {
    const child = this.watchdog
    this.watchdog = null
    if (!child?.pid) return
    try {
      process.kill(child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

function grantScript(): string {
  return `#!/bin/bash
set -euo pipefail
USER_NAME="$1"
LINE="$(/usr/bin/printf '%s ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1\\n' "$USER_NAME")"
case "$USER_NAME" in
  *[!A-Za-z0-9._-]*) echo "error: invalid user" >&2; exit 1 ;;
esac
TMP="$(/usr/bin/mktemp)"
/usr/bin/printf '%s\\n' "$LINE" > "$TMP"
if ! /usr/sbin/visudo -cf "$TMP" >/dev/null; then
  /bin/rm -f "$TMP"
  echo "error: sudoers validation failed" >&2
  exit 1
fi
/usr/bin/install -m 0440 -o root -g wheel "$TMP" "${SUDOERS_PATH}"
/bin/rm -f "$TMP"
/usr/sbin/visudo -c >/dev/null
`
}

function asQuotedForm(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runAdmin(shell: string): Promise<KeepAwakeGrantResult> {
  const script = `do shell script ${JSON.stringify(shell)} with administrator privileges`
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', script], {
      timeout: 180_000,
      encoding: 'utf8'
    })
    return { ok: true }
  } catch (err) {
    const message = messageOf(err)
    if (isAuthCancelled(err, message)) return { ok: false, cancelled: true }
    return { ok: false, error: message || 'authorization failed' }
  }
}

function isAuthCancelled(err: unknown, message: string): boolean {
  const status = (err as { status?: number } | null)?.status
  if (status === -128 || status === 128) return true
  return /user canceled|cancelled|-128/i.test(message)
}

function isGrantMissing(stderr: string): boolean {
  return /a password is required|not allowed|may not run|a terminal is required/i.test(stderr)
}

function stderrOf(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    return String((err as { stderr: unknown }).stderr)
  }
  return messageOf(err)
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

async function capture(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: 8_000,
      encoding: 'utf8'
    })
    return stdout
  } catch (err) {
    return stderrOf(err)
  }
}
