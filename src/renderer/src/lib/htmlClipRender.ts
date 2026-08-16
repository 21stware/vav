/**
 * Stream-friendly html-clip host: visual iframe first, source only in data-b64.
 * Iframe nodes are detached across markdown innerHTML ticks so interaction
 * state survives streaming updates of *other* slots.
 */

import { decodeDiagramSource, encodeDiagramSource } from './diagramRender'
import { mdBlockActionButtons } from './mdBlockActions'
import { tt } from '../i18n/useT'
import { localFileStreamUrl } from '@shared/localFileUrl'
import {
  CLIP_THEME_VAR_KEYS,
  isHtmlClipLang,
  prepareHtmlClipSrcDoc,
  resolveClipTheme,
  type HtmlClipThemeVars
} from '@shared/htmlClip'
import { buildXstateHostHtml, isXstateLang } from '@shared/xstateFence'

export { isHtmlClipLang, isXstateLang }

export type HtmlClipSlot = {
  source: string
  theme: string
  iframe: HTMLIFrameElement
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function clipThemeVars(): HtmlClipThemeVars {
  if (typeof document === 'undefined') return {}
  const cs = getComputedStyle(document.documentElement)
  const vars: HtmlClipThemeVars = {}
  for (const key of CLIP_THEME_VAR_KEYS) {
    if (key === '--vav-scheme') continue
    const value = cs.getPropertyValue(key).trim()
    if (value) vars[key] = value
  }
  vars['--vav-scheme'] =
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  return resolveClipTheme(vars)
}

export function pushClipTheme(iframe: HTMLIFrameElement): void {
  iframe.contentWindow?.postMessage({ type: 'vav-clip-theme', vars: clipThemeVars() }, '*')
}

type LiveClip = {
  iframe: HTMLIFrameElement
  source: string
  kind: 'app' | 'xstate'
}

const liveClips = new Set<LiveClip>()
let themeWatchInstalled = false
let lastHostTheme = ''

function hostTheme(): string {
  return document.documentElement.dataset.theme || 'light'
}

function installClipThemeWatch(): void {
  if (themeWatchInstalled || typeof document === 'undefined') return
  themeWatchInstalled = true
  lastHostTheme = hostTheme()
  const restyle = (): void => {
    const theme = hostTheme()
    if (theme === lastHostTheme) return
    lastHostTheme = theme
    void restyleLiveClips()
  }
  const obs = new MutationObserver(restyle)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

async function restyleLiveClips(): Promise<void> {
  const pending = [...liveClips]
  await Promise.all(
    pending.map(async (clip) => {
      if (!clip.iframe.isConnected) {
        liveClips.delete(clip)
        return
      }
      pushClipTheme(clip.iframe)
      const url = await materializeAppUrl(clip.source, clip.kind)
      if (url && clip.iframe.isConnected) clip.iframe.src = url
    })
  )
}

function registerLiveClip(
  iframe: HTMLIFrameElement,
  source: string,
  kind: 'app' | 'xstate'
): void {
  for (const clip of liveClips) {
    if (clip.iframe === iframe) {
      clip.source = source
      clip.kind = kind
      return
    }
  }
  liveClips.add({ iframe, source, kind })
  installClipThemeWatch()
}

export function renderHtmlClipFence(source: string): string {
  const raw = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const b64 = encodeDiagramSource(raw)
  return (
    `<div class="md-block md-html-clip-wrap" data-kind="html-clip" data-filename="app.html" data-clip-b64="${b64}">` +
    `<div class="md-block-bar">` +
    `${mdBlockActionButtons('source')}</div>` +
    `<div class="md-html-clip-host" data-b64="${b64}"></div>` +
    `</div>`
  )
}

export function renderXstateFence(source: string): string {
  const raw = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const b64 = encodeDiagramSource(raw)
  return (
    `<div class="md-block md-html-clip-wrap md-xstate-wrap" data-kind="xstate" data-filename="machine.json" data-clip-b64="${b64}">` +
    `<div class="md-block-bar">` +
    `${mdBlockActionButtons('source')}</div>` +
    `<div class="md-xstate-toolbar" hidden></div>` +
    `<div class="md-html-clip-host md-xstate-host" data-b64="${b64}" data-xstate="1"></div>` +
    `</div>`
  )
}

export function sourceOfHtmlClip(el: HTMLElement): string {
  const wrap = el.closest('.md-html-clip-wrap') ?? el
  const b64 = wrap.getAttribute('data-clip-b64') || el.dataset.b64 || ''
  if (b64) {
    const decoded = decodeDiagramSource(b64)
    if (decoded.trim()) return decoded
  }
  return ''
}

function applyClipHeight(iframe: HTMLIFrameElement, height: number): void {
  const next = Math.max(240, Math.min(1600, Math.round(height)))
  iframe.style.height = `${next}px`
}

function formatXstateValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value ?? '')
  }
}

function paintXstateToolbar(
  toolbar: HTMLElement,
  iframe: HTMLIFrameElement,
  payload: {
    events?: string[]
    nextEvents?: string[]
    value?: unknown
  }
): void {
  const events = payload.events ?? []
  const next = new Set(payload.nextEvents ?? events)
  const state = formatXstateValue(payload.value)
  toolbar.hidden = false
  toolbar.replaceChildren()
  const status = document.createElement('span')
  status.className = 'md-xstate-state'
  status.textContent = state ? `state ${state}` : 'state'
  toolbar.appendChild(status)
  for (const type of events) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'md-xstate-ev'
    button.textContent = type
    if (next.has(type)) button.dataset.primary = '1'
    button.addEventListener('click', () => {
      iframe.contentWindow?.postMessage({ type: 'vav-xstate-event', event: { type } }, '*')
    })
    toolbar.appendChild(button)
  }
}

function bindClipResize(iframe: HTMLIFrameElement): void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) return
    const data = event.data as {
      type?: string
      height?: number
      events?: string[]
      nextEvents?: string[]
      value?: unknown
    } | null
    if (!data) return
    if (data.type === 'vav-html-clip' && typeof data.height === 'number' && Number.isFinite(data.height)) {
      applyClipHeight(iframe, data.height)
    }
    if (data.type === 'vav-xstate-ready' || data.type === 'vav-xstate-state') {
      const toolbar = iframe
        .closest('.md-html-clip-wrap')
        ?.querySelector<HTMLElement>('.md-xstate-toolbar')
      if (toolbar) paintXstateToolbar(toolbar, iframe, data)
    }
  }
  window.addEventListener('message', onMessage)
  ;(iframe as HTMLIFrameElement & { __vavClipOff?: () => void }).__vavClipOff = () => {
    window.removeEventListener('message', onMessage)
  }
}

/**
 * Serve the app document from vav-local so the iframe origin is not the
 * renderer. Combined with allow-same-origin this unlocks IndexedDB (tldraw)
 * without giving the app access to the parent window.
 */
export function preparedClipDocument(source: string, kind: 'app' | 'xstate' = 'app'): string {
  const body = kind === 'xstate' ? buildXstateHostHtml(source) : source
  return prepareHtmlClipSrcDoc(body, clipThemeVars())
}

export async function materializeAppUrl(
  source: string,
  kind: 'app' | 'xstate' = 'app'
): Promise<string | null> {
  const writeClip = window.vav?.files?.writeClip
  if (typeof writeClip !== 'function') return null
  const html = preparedClipDocument(source, kind)
  const filename = kind === 'xstate' ? 'xstate.html' : 'app.html'
  const result = await writeClip({ filename, text: html })
  if (!result.ok) return null
  return localFileStreamUrl(result.path)
}

export function createHtmlClipIframe(host: HTMLElement): HTMLIFrameElement {
  const xstate = host.dataset.xstate === '1'
  const iframe = document.createElement('iframe')
  iframe.className = xstate ? 'md-html-clip-frame md-xstate-frame' : 'md-html-clip-frame'
  iframe.title = xstate ? 'xstate' : 'App'
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-modals')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  applyClipHeight(iframe, xstate ? 640 : 520)
  bindClipResize(iframe)
  return iframe
}

export function detachHtmlClips(root: HTMLElement, slots: HtmlClipSlot[]): void {
  const hosts = [...root.querySelectorAll<HTMLElement>('.md-html-clip-host')]
  const theme = document.documentElement.dataset.theme || 'light'
  hosts.forEach((host, index) => {
    const iframe = host.querySelector('iframe')
    if (!iframe) return
    const source = sourceOfHtmlClip(host)
    slots[index] = { source, theme: slots[index]?.theme ?? theme, iframe }
    iframe.remove()
  })
}

export async function hydrateHtmlClips(root: HTMLElement, slots: HtmlClipSlot[]): Promise<void> {
  const theme = document.documentElement.dataset.theme || 'light'
  const hosts = [...root.querySelectorAll<HTMLElement>('.md-html-clip-host')]
  await Promise.all(
    hosts.map(async (host, index) => {
      const source = sourceOfHtmlClip(host)
      const existing = slots[index]
      const kind = host.dataset.xstate === '1' ? 'xstate' : 'app'
      if (existing?.iframe && existing.source === source) {
        host.replaceChildren(existing.iframe)
        registerLiveClip(existing.iframe, source, kind)
        if (existing.theme !== theme) {
          pushClipTheme(existing.iframe)
          const url = await materializeAppUrl(source, kind)
          if (url) existing.iframe.src = url
        }
        existing.iframe.contentWindow?.postMessage({ type: 'vav-xstate-ping' }, '*')
        slots[index] = { source, theme, iframe: existing.iframe }
        return
      }
      const iframe = existing?.iframe ?? createHtmlClipIframe(host)
      const url = await materializeAppUrl(source, kind)
      if (url) iframe.src = url
      registerLiveClip(iframe, source, kind)
      slots[index] = { source, theme, iframe }
      host.replaceChildren(iframe)
    })
  )
  slots.length = hosts.length
}

export function renderOutputImage(src: string, alt: string, filename: string): string {
  return (
    `<div class="md-block md-image-wrap" data-kind="image" data-filename="${escapeHtml(filename)}">` +
    `<div class="md-block-bar">` +
    `${mdBlockActionButtons('image')}</div>` +
    `<div class="md-image-stage">` +
    `<img class="md-output-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ` +
    `title="${escapeHtml(tt('md.action.viewInWindow'))}" />` +
    `</div></div>`
  )
}

export function suggestedImageFilename(src: string, alt: string): string {
  try {
    const last = src.split(/[/?#]/).filter(Boolean).pop() || ''
    if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(last)) return last
  } catch {
    /* ignore */
  }
  const slug = alt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${slug || 'image'}.png`
}
