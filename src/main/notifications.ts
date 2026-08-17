import {
  Notification,
  Tray,
  Menu,
  app,
  nativeImage,
  BrowserWindow,
  type NativeImage
} from 'electron'
import type { AppSettings } from '@shared/types'
import { groupTrayPanes, trayIndentedLabel } from '@shared/traySessions'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME, applyDockIcon, loadAppIcon, setDockBadge } from './brand'
import { playFinishAlert } from './sound/finishAlert'
import {
  acknowledgeConversation as dropConversationAttention,
  addAttentionItem,
  dockBadgeLabel,
  type AttentionItem,
  type AttentionKind
} from '@shared/attentionBadge'
import { isDevRuntime } from './devRuntime'
import { t } from './i18n'

/** One multi-res tray glyph for the process lifetime — avoid rebuild thrash. */
let cachedTrayIcon: NativeImage | null = null

/** Retired abstract tray art (wrong brand). Remove if still on disk. */
function purgeRetiredTrayTemplates(): void {
  const roots = [
    process.resourcesPath,
    join(process.cwd(), 'build'),
    join(__dirname, '../../build'),
    join(__dirname, '../../../build')
  ]
  const names = [
    'trayTemplate.png',
    'nina.v@example.com',
    'carol.w@example.org',
    'trayTemplate-2x.png',
    'trayTemplate-3x.png'
  ]
  for (const root of roots) {
    for (const name of names) {
      const path = join(root, name)
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        // ignore
      }
    }
  }
}

export type NotifyKind = 'turn-complete' | 'ask' | 'approval' | 'request'
export type NotificationPermission = 'granted' | 'denied' | 'unknown'

/** Tray / notification target — conversation plus optional CLI pane. */
export type RunningSessionTarget = {
  conversationId: string
  title: string
  surface: 'vav' | 'cli' | 'bash'
  tabId?: string
  agentId?: string
  kind?: 'agent' | 'chat' | 'bash'
  dirKey?: string
  dirLabel?: string
  createdAt?: number
}

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

/**
 * OS notifications + system tray (settings-notifications.rpml).
 *
 * macOS: tray is optional (Dock is the primary re-summon path).
 * Windows: tray is always on — there is no Dock; close hides to tray.
 */
export class NotificationCenter {
  private tray: Tray | null = null
  private permissionAsked = false
  private runningCount = 0
  private runningSessions: RunningSessionTarget[] = []
  private lastPermission: NotificationPermission = 'unknown'
  /** Unseen complete / ask / approve / request items → Dock badge. */
  private attention: AttentionItem[] = []
  /** BrowserWindow.id → conversation currently shown in that window. */
  private viewByWindow = new Map<number, string>()
  /** Dedupe the chime when the same tool call is re-emitted. */
  private lastAlertAt = new Map<string, number>()

  constructor(
    private getSettings: () => AppSettings,
    private onOpenSession: (target: RunningSessionTarget) => void,
    private onOpenSettings: () => void,
    private onShowMain: () => void,
    _getMainWindow: () => BrowserWindow | null
  ) {}

  permissionStatus(): NotificationPermission {
    this.lastPermission = readNotificationPermission()
    return this.lastPermission
  }

  /** True while a live status / notification-area icon exists. */
  hasTray(): boolean {
    return this.tray !== null
  }

  applySettings(): void {
    const settings = this.getSettings()
    // Windows always keeps a tray icon so closing the window is reversible.
    const wantTray = IS_WIN || settings.trayEnabled
    let trayOk = false
    if (wantTray) trayOk = this.ensureTray()
    else this.destroyTray()

    if (IS_MAC && app.dock) {
      // Never hide the Dock unless the status item is actually alive — otherwise
      // the app vanishes with no way back (menu bar + Dock both empty).
      if (settings.hideDockIcon && settings.trayEnabled && trayOk) {
        app.dock.hide()
      } else {
        app.dock.show()
        // hide/show drops a runtime setIcon — re-apply after the tile is back.
        applyDockIcon()
      }
    }
    this.syncDockBadge()
  }

  /**
   * Record which conversation a workspace / companion window is showing.
   * When that window is focused, its unseen attention items are acknowledged.
   */
  noteConversationView(windowId: number, conversationId: string): void {
    if (!conversationId) return
    this.viewByWindow.set(windowId, conversationId)
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed() && focused.id === windowId) {
      this.acknowledgeConversation(conversationId)
    }
  }

  forgetWindow(windowId: number): void {
    this.viewByWindow.delete(windowId)
  }

  /** Window gained focus — clear the badge items for the session it is showing. */
  acknowledgeFocusedWindow(window: BrowserWindow | null): void {
    if (!window || window.isDestroyed()) return
    const conversationId = this.viewByWindow.get(window.id)
    if (conversationId) this.acknowledgeConversation(conversationId)
  }

  isConversationForeground(conversationId: string): boolean {
    if (!conversationId) return false
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused || focused.isDestroyed()) return false
    return this.viewByWindow.get(focused.id) === conversationId
  }

  acknowledgeConversation(conversationId: string): void {
    const next = dropConversationAttention(this.attention, conversationId)
    if (next === this.attention) return
    this.attention = next
    this.syncDockBadge()
  }

  /**
   * Play the finish-alert chime, optionally badge the Dock, and show the
   * existing OS banner. Sound is independent of notification permission.
   */
  alertUser(
    kind: NotifyKind,
    conversationId: string,
    title: string,
    body: string,
    attentionId?: string
  ): void {
    const settings = this.getSettings()
    const typeOn = notifyTypeEnabled(settings, kind)
    let chimed = false
    if (settings.notificationsEnabled && settings.notificationSound && typeOn) {
      chimed = this.playAlertOnce(attentionId ?? `${kind}:${conversationId}`)
    }
    if (typeOn && !this.isConversationForeground(conversationId)) {
      const itemKind: AttentionKind = kind === 'turn-complete' ? 'complete' : kind
      const id = attentionId ?? `${kind}:${conversationId}:${Date.now()}`
      let queue = this.attention
      // A finished turn replaces any leftover ask/approve on the same session.
      if (itemKind === 'complete') {
        queue = dropConversationAttention(queue, conversationId)
      }
      const next = addAttentionItem(queue, { id, conversationId, kind: itemKind })
      if (next !== this.attention) {
        this.attention = next
        this.syncDockBadge()
      }
    }
    if (typeOn) this.notify(kind, conversationId, title, body, chimed)
  }

  private playAlertOnce(key: string): boolean {
    const now = Date.now()
    const prev = this.lastAlertAt.get(key) ?? 0
    if (now - prev < 800) return true
    this.lastAlertAt.set(key, now)
    return playFinishAlert()
  }

  private syncDockBadge(): void {
    setDockBadge(dockBadgeLabel(this.attention.length))
  }

  setRunningCount(count: number): void {
    this.runningCount = Math.max(0, count)
    this.refreshTrayTitle()
  }

  notify(
    kind: NotifyKind,
    conversationId: string,
    title: string,
    body: string,
    alreadyChiming = false
  ): void {
    const settings = this.getSettings()
    if (!settings.notificationsEnabled) return
    if (kind === 'turn-complete' && !settings.notifyOnTurnComplete) return
    if (kind === 'ask' && !settings.notifyOnAskUserQuestion) return
    if (kind === 'approval' && !settings.notifyOnToolApproval) return
    if (kind === 'request' && !settings.notifyOnRequest) return

    if (!Notification.isSupported()) return
    this.lastPermission = readNotificationPermission()
    if (this.lastPermission === 'denied') return
    void this.ensurePermission()

    const notification = new Notification({
      title,
      body: truncate(body, 120),
      silent: alreadyChiming || !settings.notificationSound
    })
    notification.on('click', () =>
      this.onOpenSession({
        conversationId,
        title: title,
        surface: 'vav'
      })
    )
    notification.show()
  }

  private async ensurePermission(): Promise<void> {
    if (this.permissionAsked) return
    this.permissionAsked = true
    // First show triggers the system prompt on macOS when still undetermined.
  }

  /** @returns true when a live Tray status item exists. */
  private ensureTray(): boolean {
    if (this.tray) {
      this.refreshTrayMenu()
      return true
    }
    const icon = trayIcon()
    if (icon.isEmpty()) {
      console.error('[tray] empty icon — refusing to create blank status item')
      return false
    }
    try {
      this.tray = new Tray(icon)
    } catch (err) {
      console.error('[tray] failed to create status item', err)
      this.tray = null
      return false
    }
    this.tray.setToolTip(APP_NAME)
    if (IS_MAC && isDevRuntime()) this.tray.setTitle('DEV')
    // Left-click: show running-session menu when any CLI/bash/VAV work is live;
    // otherwise open the main window. Right-click always shows the menu.
    this.tray.on('click', () => {
      if (this.runningSessions.length > 0) {
        this.tray?.popUpContextMenu()
      } else {
        this.onShowMain()
      }
    })
    this.tray.on('double-click', () => this.onShowMain())
    this.tray.on('right-click', () => this.tray?.popUpContextMenu())
    this.refreshTrayMenu()
    this.refreshTrayTitle()
    const size = icon.getSize()
    const scales = icon.getScaleFactors?.() ?? []
    console.log(
      `[tray] status item ready ${size.width}x${size.height}pt scales=[${scales.join(',')}] platform=${process.platform}`
    )
    return true
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private refreshTrayTitle(): void {
    if (!this.tray) return
    // macOS menu bar can show a numeric title; Windows uses tooltip only.
    if (IS_MAC) {
      if (isDevRuntime()) {
        this.tray.setTitle(this.runningCount > 0 ? `DEV ${this.runningCount}` : 'DEV')
      } else {
        this.tray.setTitle(this.runningCount > 0 ? String(this.runningCount) : '')
      }
    }
    this.tray.setToolTip(
      this.runningCount > 0 ? t('tray.sessions', { count: this.runningCount }) : APP_NAME
    )
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return
    const items: Electron.MenuItemConstructorOptions[] = []
    if (this.runningSessions.length === 0) {
      items.push({ label: APP_NAME, enabled: false })
    } else {
      items.push({
        label: t('tray.sessions', { count: this.runningSessions.length }),
        enabled: false
      })
      const groups = groupTrayPanes(
        this.runningSessions.map((row) => ({
          conversationId: row.conversationId,
          tabId: row.tabId ?? '',
          kind: row.kind === 'bash' ? 'bash' : row.kind === 'agent' ? 'agent' : 'chat',
          sessionTitle: row.title,
          paneTitle: row.title,
          dirKey: row.dirKey || '~',
          dirLabel: row.dirLabel || row.dirKey || '~',
          createdAt: row.createdAt ?? 0,
          agentId: row.agentId
        }))
      )
      for (const group of groups) {
        items.push({ type: 'separator' })
        items.push({ label: group.dirLabel, enabled: false })
        for (const pane of group.panes) {
          const row = this.runningSessions.find(
            (s) =>
              s.conversationId === pane.conversationId &&
              (s.tabId ?? '') === pane.tabId &&
              (s.kind ?? 'chat') === pane.kind
          )
          if (!row) continue
          items.push({
            label: trayIndentedLabel(row.title),
            click: () => this.onOpenSession(row)
          })
        }
      }
    }
    items.push(
      { type: 'separator' },
      { label: t('common.open'), click: () => this.onShowMain() },
      { label: t('common.settingsEllipsis'), click: () => this.onOpenSettings() },
      { label: t('common.quit'), click: () => app.quit() }
    )
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  /** Rebuild the tray list. `runningCount` is the live badge; omit to use list length. */
  updateRunningSessions(sessions: RunningSessionTarget[], runningCount = sessions.length): void {
    this.runningSessions = sessions
    this.setRunningCount(runningCount)
    this.refreshTrayMenu()
  }
}

function notifyTypeEnabled(settings: AppSettings, kind: NotifyKind): boolean {
  if (kind === 'turn-complete') return settings.notifyOnTurnComplete !== false
  if (kind === 'ask') return settings.notifyOnAskUserQuestion !== false
  if (kind === 'approval') return settings.notifyOnToolApproval !== false
  if (kind === 'request') return settings.notifyOnRequest !== false
  return true
}

function truncate(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/** Best-effort read of macOS notification authorization; other platforms grant. */
function readNotificationPermission(): NotificationPermission {
  if (process.platform !== 'darwin') return 'granted'
  try {
    const probe = app as unknown as {
      getNotificationSettings?: () => { authorizationStatus?: string | number }
    }
    const status = probe.getNotificationSettings?.()?.authorizationStatus
    if (status === undefined || status === null) return 'unknown'
    const value = String(status).toLowerCase()
    if (value === 'denied' || value === '1') return 'denied'
    if (
      value === 'authorized' ||
      value === 'granted' ||
      value === 'provisional' ||
      value === '2' ||
      value === '3'
    ) {
      return 'granted'
    }
    if (value === 'notdetermined' || value === '0') return 'unknown'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Tray glyph — derived from brand `icon-mark.png` (cat “a”), not the retired
 * abstract `trayTemplate*.png` set (wrong art; deleted).
 *
 * - macOS: multi-res template (22/44/66pt) so Retina stays sharp; system
 *   tints the mark light/dark via `setTemplateImage`.
 * - Win/Linux: colour multi-res from the same mark.
 */
function trayIcon(): NativeImage {
  if (cachedTrayIcon && !cachedTrayIcon.isEmpty()) return cachedTrayIcon

  // Drop the wrong abstract trayTemplate set if present (dev build/ or old install).
  purgeRetiredTrayTemplates()

  const built = buildTrayIcon()
  if (!built.isEmpty()) cachedTrayIcon = built
  return built
}

function buildTrayIcon(): NativeImage {
  const mark = loadBrandMarkSource()
  if (mark && !mark.isEmpty()) {
    if (IS_MAC) {
      const template = trayTemplateFromMark(mark)
      if (template && !template.isEmpty()) return template
    }
    const color = trayColorFromMark(mark)
    if (color && !color.isEmpty()) return color
  }

  if (IS_MAC) {
    try {
      const named = nativeImage.createFromNamedImage('NSActionTemplate')
      if (named && !named.isEmpty()) {
        named.setTemplateImage(true)
        return named
      }
    } catch {
      // fall through
    }
  }

  console.warn('[tray] missing icon-mark — status item may be blank')
  return nativeImage.createEmpty()
}

/** Large brand mark used for Dock / tray (icon-mark preferred over full plate). */
function loadBrandMarkSource(): NativeImage | null {
  const path = resolveBrandAsset(['icon-mark.png', 'icon-mark-dark.png', 'icon.png'])
  if (!path) return loadAppIcon('light') ?? null
  const img = nativeImage.createFromPath(path)
  return img.isEmpty() ? null : img
}

/**
 * Menu-bar template: black ink + alpha only (no plate fill).
 * Feeding the full icon-mark (cream/black rounded square) as a template made
 * the entire tile render as a solid black block — AppKit treats every opaque
 * pixel as “ink”.
 */
function trayTemplateFromMark(source: NativeImage): NativeImage | null {
  const image = nativeImage.createEmpty()
  const sizes: Array<{ px: number; scale: number }> = [
    { px: 22, scale: 1 },
    { px: 44, scale: 2 },
    { px: 66, scale: 3 }
  ]
  try {
    for (const { px, scale } of sizes) {
      const sil = silhouetteForTemplate(source, px)
      if (!sil || sil.isEmpty()) continue
      const marked = isDevRuntime() ? paintTemplateDevBar(sil) : sil
      if (!marked || marked.isEmpty()) continue
      image.addRepresentation({
        scaleFactor: scale,
        width: px,
        height: px,
        buffer: marked.toPNG()
      })
    }
    if (image.isEmpty()) return null
    image.setTemplateImage(true)
    return image
  } catch (err) {
    console.warn('[tray] failed to build template from mark', err)
    return null
  }
}

function paintTemplateDevBar(source: NativeImage): NativeImage {
  const { width, height } = source.getSize()
  const dst = Buffer.from(source.toBitmap())
  if (width < 8 || height < 8 || dst.length < width * height * 4) return source
  const y0 = Math.round(height * 0.82)
  const y1 = Math.min(height, Math.round(height * 0.94))
  const x0 = Math.round(width * 0.16)
  const x1 = Math.round(width * 0.84)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      dst[i] = 0
      dst[i + 1] = 0
      dst[i + 2] = 0
      dst[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(dst, { width, height })
}

/**
 * Convert a full-colour app mark into black-on-transparent ink for template images.
 * Light plate (cream + dark cat) → dark pixels become ink.
 * Dark plate (black + light cat) → light pixels become ink.
 */
function silhouetteForTemplate(source: NativeImage, px: number): NativeImage | null {
  try {
    const resized = source.resize({ width: px, height: px, quality: 'best' })
    const { width, height } = resized.getSize()
    if (width <= 0 || height <= 0) return null
    // BGRA, premultiplied on some platforms — we recompute alpha from luminance.
    const bgra = Buffer.from(resized.toBitmap())
    if (bgra.length < width * height * 4) return null

    // Sample corners to decide whether the plate is light or dark.
    const cornerIdx = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      ((height - 1) * width + (width - 1)) * 4
    ]
    let cornerLum = 0
    for (const c of cornerIdx) {
      const b = bgra[c] ?? 0
      const g = bgra[c + 1] ?? 0
      const r = bgra[c + 2] ?? 0
      cornerLum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    cornerLum /= cornerIdx.length
    const darkPlate = cornerLum < 128

    for (let i = 0; i < bgra.length; i += 4) {
      const b = bgra[i] ?? 0
      const g = bgra[i + 1] ?? 0
      const r = bgra[i + 2] ?? 0
      const a = bgra[i + 3] ?? 0
      if (a < 12) {
        bgra[i] = 0
        bgra[i + 1] = 0
        bgra[i + 2] = 0
        bgra[i + 3] = 0
        continue
      }
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      // Ink strength: how far from the plate background toward the glyph.
      let ink = darkPlate ? lum : 255 - lum
      // Soft threshold so soft shadows / plate edges fall away.
      ink = Math.max(0, Math.min(255, (ink - 48) * 1.55))
      const alpha = Math.round(ink * (a / 255))
      // Template ink is black; system recolors via setTemplateImage.
      bgra[i] = 0
      bgra[i + 1] = 0
      bgra[i + 2] = 0
      bgra[i + 3] = alpha
    }

    return nativeImage.createFromBitmap(bgra, { width, height })
  } catch (err) {
    console.warn('[tray] silhouette failed', err)
    return null
  }
}

/** Colour mark with 16pt + 32pt bitmaps so Win/Linux tray isn’t a soft 16px upscale. */
function trayColorFromMark(source: NativeImage): NativeImage | null {
  const image = nativeImage.createEmpty()
  try {
    const px16 = source.resize({ width: 16, height: 16, quality: 'best' })
    const px32 = source.resize({ width: 32, height: 32, quality: 'best' })
    image.addRepresentation({
      scaleFactor: 1,
      width: 16,
      height: 16,
      buffer: px16.toPNG()
    })
    image.addRepresentation({
      scaleFactor: 2,
      width: 32,
      height: 32,
      buffer: px32.toPNG()
    })
    if (!image.isEmpty()) return image
  } catch {
    // fall through
  }
  try {
    return source.resize({ width: 16, height: 16, quality: 'best' })
  } catch {
    return null
  }
}

function resolveBrandAsset(files: string[]): string | null {
  const roots = [
    process.resourcesPath,
    join(process.cwd(), 'build'),
    join(__dirname, '../../build'),
    join(__dirname, '../../../build'),
    join(app.getAppPath(), 'build'),
    join(app.getAppPath(), '../build')
  ]
  for (const root of roots) {
    for (const file of files) {
      const path = join(root, file)
      if (existsSync(path)) return path
    }
  }
  return null
}


