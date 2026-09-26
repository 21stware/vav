import { BrowserWindow, nativeTheme, screen } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { runAgentLoop } from '@earendil-works/pi-agent-core'
import { currentLocale } from '../i18n'
import { isE2eRuntime } from '../e2eRuntime'
import { buildModel, streamWith } from '../agent/provider'
import { createWebTools } from '../agent/toolsWeb'
import type { ToolHost } from '../agent/toolHost'
import {
  buildFaaaaastSystemPrompt,
  extractFaaaaastStreamText,
  normalizeFaaaaastInput,
  parseFaaaaastModelText,
  solveFaaaaastLocal,
  type FaaaaastAskRequest,
  type FaaaaastAskResult,
  type FaaaaastInitPayload
} from '@shared/faaaaast'
import { vendorFromEndpoint } from '@shared/llmVendors'
import { appearanceForMachine } from '@shared/machineAppearance'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import type { WebSearchService } from '../web/WebSearchService'
import type { WebFetchService } from '../web/WebFetchService'

const CARD_WIDTH = 380
const CARD_MIN_HEIGHT = 44
const CARD_MAX_HEIGHT = 440
const MARGIN = 20

export type FaaaaastHost = {
  loadRenderer: (window: BrowserWindow) => void
  getSettings: () => AppSettings
  resolveCredentials: () => { apiKey: string | null; endpoint: string }
  webSearch: WebSearchService
  webFetch: WebFetchService
  searchKeys: () => { brave?: string; tinyfish?: string }
}

function windowTheme(settings: AppSettings): 'light' | 'dark' {
  const look = appearanceForMachine(settings, LOCAL_MACHINE_ID)
  if (look.theme === 'light' || look.theme === 'dark') return look.theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function plateColor(settings: AppSettings): string {
  return windowTheme(settings) === 'dark' ? '#1b1b1d' : '#fcfcfc'
}

export function createFaaaaastController(host: FaaaaastHost): {
  toggle: () => void
  show: () => void
  hide: () => void
  ask: (request: unknown) => Promise<FaaaaastAskResult>
  cancel: () => void
  resize: (height: unknown) => void
  isOverlay: (win: BrowserWindow) => boolean
  isOpen: () => boolean
} {
  let window: BrowserWindow | null = null
  let abort: AbortController | null = null
  let shownAt = 0
  let busy = false
  let thread: AgentMessage[] = []

  const isOverlay = (win: BrowserWindow): boolean => window != null && win === window

  const hide = (): void => {
    abort?.abort()
    abort = null
    if (!window || window.isDestroyed()) return
    try {
      window.hide()
    } catch {
      // ignore
    }
  }

  const ensureWindow = (): BrowserWindow => {
    if (window && !window.isDestroyed()) return window
    const win = new BrowserWindow({
      width: CARD_WIDTH,
      height: CARD_MIN_HEIGHT,
      title: '',
      frame: false,
      transparent: false,
      show: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      movable: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      focusable: true,
      backgroundColor: plateColor(host.getSettings()),
      ...(process.platform === 'darwin'
        ? { type: 'panel' as const, roundedCorners: true }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    try {
      win.setAlwaysOnTop(true, 'pop-up-menu')
    } catch {
      // ignore
    }
    try {
      // The default process-type transform hides every app window (main included).
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
    } catch {
      // ignore
    }
    win.on('blur', () => {
      if (win.isDestroyed() || !win.isVisible()) return
      if (busy) return
      if (Date.now() - shownAt < 200) return
      hide()
    })
    win.on('closed', () => {
      if (window === win) window = null
    })
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'Escape' || input.code === 'Escape') {
        event.preventDefault()
        hide()
      }
    })
    host.loadRenderer(win)
    window = win
    return win
  }

  const workAreaFor = (win: BrowserWindow, fromCursor: boolean): Electron.Rectangle => {
    if (fromCursor) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    return screen.getDisplayMatching(win.getBounds()).workArea
  }

  const pinBottomRight = (win: BrowserWindow, height: number, fromCursor: boolean): void => {
    const area = workAreaFor(win, fromCursor)
    win.setBounds({
      width: CARD_WIDTH,
      height,
      x: Math.round(area.x + area.width - CARD_WIDTH - MARGIN),
      y: Math.round(area.y + area.height - height - MARGIN)
    })
  }

  const initPayload = (): FaaaaastInitPayload => {
    const settings = host.getSettings()
    const vendor = vendorFromEndpoint(host.resolveCredentials().endpoint)
    return {
      locale: currentLocale(),
      theme: windowTheme(settings),
      displayCurrency: settings.displayCurrency,
      markId: vendor?.id ?? 'vav',
      markName: vendor?.name ?? 'VAV'
    }
  }

  const sendInit = (win: BrowserWindow): void => {
    try {
      win.webContents.send(IPC.faaaaastInit, initPayload())
    } catch {
      // ignore
    }
  }

  const show = (): void => {
    thread = []
    const win = ensureWindow()
    try {
      win.setBackgroundColor(plateColor(host.getSettings()))
    } catch {
      // ignore
    }
    pinBottomRight(win, CARD_MIN_HEIGHT, true)
    shownAt = Date.now()
    const theme = windowTheme(host.getSettings())
    const reveal = (): void => {
      if (win.isDestroyed()) return
      sendInit(win)
      if (!win.isVisible()) win.show()
      win.focus()
      try {
        win.webContents.focus()
      } catch {
        // ignore
      }
    }
    let url = ''
    try {
      url = win.webContents.getURL()
    } catch {
      // ignore
    }
    if (url && !url.includes(`theme=${theme}`)) {
      host.loadRenderer(win)
      win.webContents.once('did-finish-load', reveal)
      return
    }
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', reveal)
      return
    }
    reveal()
  }

  const toggle = (): void => {
    if (window && !window.isDestroyed() && window.isVisible()) {
      hide()
      return
    }
    show()
  }

  const resize = (height: unknown): void => {
    if (!window || window.isDestroyed()) return
    const next = Math.round(Number(height))
    if (!Number.isFinite(next)) return
    const h = Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, next))
    pinBottomRight(window, h, false)
  }

  const cancel = (): void => {
    abort?.abort()
    abort = null
  }

  const askAgent = async (text: string): Promise<FaaaaastAskResult> => {
    const settings = host.getSettings()
    const creds = host.resolveCredentials()
    const apiKey = creds.apiKey
    if (!apiKey) return { ok: false, error: 'no-key' }
    if (isE2eRuntime() && process.env.VAV_E2E_STUB_TURN === '1') {
      return {
        ok: true,
        kind: 'translate',
        title: 'faaaaast',
        answer: 'e2e faaaaast',
        local: false
      }
    }
    const locale = currentLocale()
    const signal = abort?.signal
    const merged: AppSettings = {
      ...settings,
      apiEndpoint: creds.endpoint.trim() || settings.apiEndpoint
    }
    const model = buildModel(merged, settings.defaultModel)
    const tools = createWebTools(webToolHost(host))
    const prompt: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now()
    }
    let llmTurns = 0
    let lastText = ''
    let loopError: string | undefined
    const pushDelta = (raw: string): void => {
      const visible = extractFaaaaastStreamText(raw)
      if (!visible || !window || window.isDestroyed()) return
      try {
        window.webContents.send(IPC.faaaaastDelta, { text: visible })
      } catch {
        // ignore
      }
    }
    try {
      const created = await runAgentLoop(
        [prompt],
        {
          systemPrompt: buildFaaaaastSystemPrompt({
            locale,
            displayCurrency: settings.displayCurrency
          }),
          messages: thread,
          tools: [...tools]
        },
        {
          model,
          apiKey,
          maxTokens: 1536,
          signal,
          toolExecution: 'sequential',
          convertToLlm: (messages) => messages as AgentMessage[] as never,
          shouldStopAfterTurn: ({ message }) => {
            const textOut = assistantPlainText(message)
            if (textOut) lastText = textOut
            llmTurns += 1
            return llmTurns >= 6
          }
        },
        (event) => {
          if (event.type === 'message_start' && event.message.role === 'assistant') {
            lastText = ''
          }
          if (event.type === 'message_update') {
            const fromMsg = assistantPlainText(event.message)
            const ev = (
              event as { assistantMessageEvent?: { type?: string; delta?: unknown } }
            ).assistantMessageEvent
            if (fromMsg) lastText = fromMsg
            else if (ev?.type === 'text_delta' && typeof ev.delta === 'string') {
              lastText += ev.delta
            }
            if (lastText) pushDelta(lastText)
          }
          if (event.type !== 'message_end' || event.message.role !== 'assistant') return
          const message = event.message
          if ('stopReason' in message && message.stopReason === 'error') {
            loopError =
              'errorMessage' in message && typeof message.errorMessage === 'string'
                ? message.errorMessage
                : 'failed'
          }
          const textOut = assistantPlainText(message)
          if (textOut) {
            lastText = textOut
            pushDelta(textOut)
          }
        },
        signal,
        (model_, context, options) => streamWith(model_, context, { ...options, apiKey })
      )
      thread = [...thread, ...created]
      if (signal?.aborted) return { ok: false, error: 'failed' }
      if (loopError) {
        console.warn('[faaaaast] model error', loopError)
        return { ok: false, error: 'failed', message: loopError }
      }
      if (!lastText) {
        const last = [...created].reverse().find((message) => message.role === 'assistant')
        lastText = last ? assistantPlainText(last) : ''
      }
      if (!lastText) {
        console.warn('[faaaaast] empty model text')
        return { ok: false, error: 'failed' }
      }
      return { ok: true, ...parseFaaaaastModelText(lastText) }
    } catch (err) {
      if (signal?.aborted) return { ok: false, error: 'failed' }
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[faaaaast] ask threw', message)
      return { ok: false, error: 'failed', message }
    }
  }

  const ask = async (request: unknown): Promise<FaaaaastAskResult> => {
    const rec = request && typeof request === 'object' ? (request as FaaaaastAskRequest) : null
    const text = normalizeFaaaaastInput(rec?.text ?? '')
    if (!text) return { ok: false, error: 'empty' }
    const locale = currentLocale()
    const local = solveFaaaaastLocal(text, {
      locale,
      displayCurrency: host.getSettings().displayCurrency
    })
    if (local) return { ok: true, ...local }
    busy = true
    abort?.abort()
    abort = new AbortController()
    try {
      return await askAgent(text)
    } finally {
      abort = null
      busy = false
      if (window && !window.isDestroyed() && !window.isFocused()) hide()
    }
  }

  return { toggle, show, hide, ask, cancel, resize, isOverlay, isOpen: () => Boolean(window?.isVisible()) }
}

function webToolHost(host: FaaaaastHost): ToolHost {
  return {
    workdir: homedir(),
    settings: () => host.getSettings(),
    conversationId: 'faaaaast',
    mirror: () => undefined,
    fsChanged: () => undefined,
    ask: async () => ({ text: '', cancelled: true }),
    webSearch: host.webSearch,
    webFetch: host.webFetch,
    braveSearchKey: () => host.searchKeys().brave ?? null,
    tinyfishSearchKey: () => host.searchKeys().tinyfish ?? null
  } as unknown as ToolHost
}

function assistantPlainText(message: AgentMessage): string {
  if (message.role !== 'assistant' || !('content' in message) || !Array.isArray(message.content)) {
    return ''
  }
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
}
