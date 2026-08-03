/**
 * Optional Chromium render path for SPA / JS-heavy pages.
 *
 * Uses a single hidden offscreen BrowserWindow (serialized) so concurrent
 * agent tools do not spawn a window farm. Start URL and final URL go through
 * the SSRF guard; mid-load redirects with obvious private hosts are cancelled.
 */

import { BrowserWindow, session } from 'electron'
import { isIP } from 'node:net'
import { assertPublicHttpUrl, isBlockedIp, SsrfError } from './ssrf'

export interface RenderFetchOptions {
  url: string
  timeoutMs?: number
  settleMs?: number
  signal?: AbortSignal
}

export interface RenderFetchResult {
  ok: boolean
  error?: string
  finalUrl?: string
  html?: string
  title?: string
}

const PARTITION = 'persist:vav-web-fetch'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_SETTLE_MS = 800

/** One render at a time — cheap mutex. */
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export class RenderedHtmlFetcher {
  async fetch(opts: RenderFetchOptions): Promise<RenderFetchResult> {
    return enqueue(() => this.fetchExclusive(opts))
  }

  private async fetchExclusive(opts: RenderFetchOptions): Promise<RenderFetchResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const settleMs = opts.settleMs ?? DEFAULT_SETTLE_MS
    let startUrl: string
    try {
      startUrl = (await assertPublicHttpUrl(opts.url)).href
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }

    if (opts.signal?.aborted) {
      return { ok: false, error: 'Request aborted' }
    }

    const ses = session.fromPartition(PARTITION, { cache: false })

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        images: false,
        webgl: false,
        offscreen: true
      }
    })

    const blockNav = (url: string): boolean => {
      try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
        const host = u.hostname.toLowerCase()
        if (
          host === 'localhost' ||
          host.endsWith('.localhost') ||
          host.endsWith('.local') ||
          host === 'metadata' ||
          host === 'metadata.google.internal'
        ) {
          return true
        }
        if (isIP(host) && isBlockedIp(host)) return true
        const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
        if (port !== 80 && port !== 443) return true
        return false
      } catch {
        return true
      }
    }

    win.webContents.on('will-navigate', (event, url) => {
      if (blockNav(url)) event.preventDefault()
    })
    win.webContents.on('will-redirect', (event, url) => {
      if (blockNav(url)) event.preventDefault()
    })

    const abort = (): void => {
      try {
        if (!win.isDestroyed()) win.webContents.stop()
      } catch {
        /* ignore */
      }
    }
    opts.signal?.addEventListener('abort', abort, { once: true })

    try {
      const loaded = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new SsrfError(`Render timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        win.webContents.once('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
          if (!isMainFrame) return
          // -3 is ABORTED (e.g. we cancelled a private redirect) — ignore if another load continues
          if (code === -3) return
          clearTimeout(timer)
          reject(new Error(`Render load failed (${code}): ${desc} @ ${validatedURL}`))
        })

        win.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
      })

      await win.loadURL(startUrl, {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      })
      await loaded

      if (settleMs > 0) {
        await sleep(settleMs, opts.signal)
      }

      const finalUrl = win.webContents.getURL()
      try {
        await assertPublicHttpUrl(finalUrl)
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          finalUrl
        }
      }

      const html = (await win.webContents.executeJavaScript(
        `document.documentElement ? document.documentElement.outerHTML : ''`
      )) as string
      const title = (await win.webContents.executeJavaScript(`document.title || ''`)) as string

      if (!html || html.length < 40) {
        return { ok: false, error: 'Render produced empty HTML', finalUrl }
      }

      return { ok: true, finalUrl, html, title: title?.trim() || undefined }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      opts.signal?.removeEventListener('abort', abort)
      if (!win.isDestroyed()) win.destroy()
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request aborted'))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new Error('Request aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
