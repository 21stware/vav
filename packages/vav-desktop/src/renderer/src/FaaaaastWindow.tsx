import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AppLocale } from '@shared/i18n'
import { t } from '@shared/i18n'
import {
  faaaaastLooksLikeEnglish,
  type FaaaaastInitPayload,
  type FaaaaastKind,
  type FaaaaastTurn
} from '@shared/faaaaast'
import type { AppSettings } from '@shared/types'
import { AgentBrandMark } from './components/AgentBrandMark'
import { paintDocumentLook } from './lib/paintAppearance'

const INPUT_LINE_HEIGHT = 20

type LogRow =
  | { id: string; role: 'user'; text: string }
  | {
      id: string
      role: 'assistant'
      pending?: boolean
      kind?: FaaaaastKind
      title?: string
      text: string
      note?: string
      ipa?: string
    }

const KIND_KEY: Record<FaaaaastKind, `faaaaast.kind.${FaaaaastKind}`> = {
  translate: 'faaaaast.kind.translate',
  currency: 'faaaaast.kind.currency',
  unit: 'faaaaast.kind.unit',
  timezone: 'faaaaast.kind.timezone',
  math: 'faaaaast.kind.math',
  define: 'faaaaast.kind.define',
  date: 'faaaaast.kind.date',
  encode: 'faaaaast.kind.encode',
  other: 'faaaaast.kind.other'
}

function kindLabel(locale: AppLocale, kind: FaaaaastKind | undefined, title?: string): string {
  if (title?.trim()) return title.trim()
  if (kind) return t(locale, KIND_KEY[kind])
  return t(locale, 'faaaaast.kind.other')
}

function nextId(): string {
  return `fa-${Math.random().toString(36).slice(2, 9)}`
}

function growInput(el: HTMLTextAreaElement, value: string): void {
  el.style.height = `${INPUT_LINE_HEIGHT}px`
  if (!value) return
  el.style.height = `${Math.min(el.scrollHeight, 96)}px`
}

function speakEnglish(
  text: string,
  handlers: { onend?: () => void; onerror?: () => void } = {}
): void {
  if (typeof speechSynthesis === 'undefined' || !text.trim()) return
  speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'en-US'
  utter.rate = 0.95
  const voice = speechSynthesis.getVoices().find((item) => item.lang.startsWith('en'))
  if (voice) utter.voice = voice
  if (handlers.onend) utter.onend = handlers.onend
  if (handlers.onerror) utter.onerror = handlers.onerror
  speechSynthesis.speak(utter)
}

export function FaaaaastWindow(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [locale, setLocale] = useState<AppLocale>('zh-CN')
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [mark, setMark] = useState({ id: 'vav', name: 'VAV' })
  const [text, setText] = useState('')
  const [log, setLog] = useState<LogRow[]>([])
  const [error, setError] = useState<'no-key' | 'failed' | 'empty' | null>(null)
  const [copied, setCopied] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const asking = useRef(false)
  const osDarkRef = useRef(theme === 'dark')
  const accentRef = useRef('#007aff')

  const paintFromSettings = useCallback((settings: AppSettings, osDark: boolean) => {
    const next = paintDocumentLook({
      settings,
      osDark,
      systemAccent: accentRef.current,
      vibrancy: false
    })
    setTheme(next)
  }, [])

  const applyInit = useCallback(
    (payload: FaaaaastInitPayload) => {
      setLocale(payload.locale)
      osDarkRef.current = payload.theme === 'dark'
      setMark({ id: payload.markId || 'vav', name: payload.markName || 'VAV' })
      setLog([])
      setError(null)
      setCopied(false)
      setSpeakingId(null)
      setText('')
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
      void window.vav.settings.get().then((settings) => {
        paintFromSettings(settings, osDarkRef.current)
      })
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [paintFromSettings]
  )

  useEffect(() => {
    return window.vav.faaaaast.onInit(applyInit)
  }, [applyInit])

  useEffect(() => {
    return window.vav.faaaaast.onDelta((payload) => {
      if (!asking.current || !payload.text) return
      setLog((prev) => {
        const pending = [...prev].reverse().find((row) => row.role === 'assistant' && row.pending)
        if (!pending) return prev
        return prev.map((row) => (row.id === pending.id ? { ...row, text: payload.text } : row))
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.vav.settings.get().then((settings) => {
      if (!cancelled) paintFromSettings(settings, osDarkRef.current)
    })
    void window.vav.window.getAccentColor?.().then((hex) => {
      if (cancelled || !hex) return
      accentRef.current = hex
      void window.vav.settings.get().then((settings) => {
        if (!cancelled) paintFromSettings(settings, osDarkRef.current)
      })
    })
    const offAccent = window.vav.window.onAccentColorChanged?.((hex) => {
      if (!hex) return
      accentRef.current = hex
      void window.vav.settings.get().then((settings) => {
        paintFromSettings(settings, osDarkRef.current)
      })
    })
    const offSettings = window.vav.onSettingsChanged((settings) => {
      paintFromSettings(settings, osDarkRef.current)
    })
    return () => {
      cancelled = true
      offAccent?.()
      offSettings()
    }
  }, [paintFromSettings])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const publish = (): void => {
      window.vav.faaaaast.resize(Math.ceil(el.scrollHeight))
    }
    publish()
    const obs = new ResizeObserver(publish)
    obs.observe(el)
    return () => obs.disconnect()
  }, [log, text, error])

  useLayoutEffect(() => {
    const scroller = logRef.current
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  }, [log])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    growInput(el, text)
  }, [text])

  useEffect(() => {
    return () => {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    }
  }, [])

  const copyAnswer = useCallback(async (answer: string) => {
    try {
      await navigator.clipboard.writeText(answer)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }, [])

  const submit = useCallback(async () => {
    const next = text.trim()
    if (!next || asking.current) return
    asking.current = true
    setError(null)
    setCopied(false)
    setText('')
    const userId = nextId()
    const pendingId = nextId()
    const history: FaaaaastTurn[] = log
      .filter((row) => !('pending' in row && row.pending))
      .map((row) => ({ role: row.role, text: row.text }))
    setLog((prev) => [
      ...prev,
      { id: userId, role: 'user', text: next },
      { id: pendingId, role: 'assistant', pending: true, text: '' }
    ])
    try {
      const result = await window.vav.faaaaast.ask({ text: next, history })
      if (!result.ok) {
        setLog((prev) => prev.filter((row) => row.id !== pendingId))
        setError(result.error)
        return
      }
      setLog((prev) =>
        prev.map((row) =>
          row.id === pendingId
            ? {
                id: pendingId,
                role: 'assistant',
                kind: result.kind,
                title: result.title,
                text: result.answer,
                note: result.note,
                ipa: result.ipa
              }
            : row
        )
      )
    } catch {
      setLog((prev) => prev.filter((row) => row.id !== pendingId))
      setError('failed')
    } finally {
      asking.current = false
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [log, text])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const listen = useCallback((id: string, answer: string) => {
    if (typeof speechSynthesis === 'undefined') return
    if (speakingId === id && speechSynthesis.speaking) {
      speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }
    setSpeakingId(id)
    speakEnglish(answer, {
      onend: () => setSpeakingId((current) => (current === id ? null : current)),
      onerror: () => setSpeakingId((current) => (current === id ? null : current))
    })
  }, [speakingId])

  const logging = log.length > 0
  const lastAnswer = [...log].reverse().find((row) => row.role === 'assistant' && !row.pending)

  return (
    <div
      ref={rootRef}
      className={`faaaaast-root${logging ? ' is-log' : ''}`}
      data-theme={theme}
      data-testid="faaaaast"
    >
      <div className="faaaaast-box">
        {logging && (
          <div ref={logRef} className="faaaaast-log" data-testid="faaaaast-result">
            {log.map((row) =>
              row.role === 'user' ? (
                <div key={row.id} className="faaaaast-line is-user">
                  {row.text}
                </div>
              ) : row.pending ? (
                <div key={row.id} className="faaaaast-line is-pending">
                  {row.text ? (
                    <p className="faaaaast-answer is-stream">{row.text}</p>
                  ) : (
                    <>
                      <span className="faaaaast-shimmer-text">{t(locale, 'common.loading')}</span>
                      <div className="faaaaast-shimmer-lines" aria-hidden>
                        <span className="faaaaast-shimmer-line" />
                        <span className="faaaaast-shimmer-line is-short" />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div key={row.id} className="faaaaast-line is-assistant">
                  <div className="faaaaast-line-head">
                    <span className="faaaaast-kind">{kindLabel(locale, row.kind, row.title)}</span>
                    {lastAnswer?.id === row.id ? (
                      <button
                        type="button"
                        className="faaaaast-copy"
                        onClick={() => void copyAnswer(row.text)}
                      >
                        {copied ? t(locale, 'common.copied') : t(locale, 'common.copy')}
                      </button>
                    ) : null}
                  </div>
                  <p className="faaaaast-answer">{row.text}</p>
                  {row.ipa || faaaaastLooksLikeEnglish(row.text) ? (
                    <div className="faaaaast-pronounce">
                      {row.ipa ? <span className="faaaaast-ipa">{row.ipa}</span> : null}
                      <button
                        type="button"
                        className={`faaaaast-listen${speakingId === row.id ? ' is-playing' : ''}`}
                        aria-label={
                          speakingId === row.id
                            ? t(locale, 'faaaaast.listening')
                            : t(locale, 'faaaaast.listen')
                        }
                        title={
                          speakingId === row.id
                            ? t(locale, 'faaaaast.listening')
                            : t(locale, 'faaaaast.listen')
                        }
                        onClick={() => listen(row.id, row.text)}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden>
                          <path
                            fill="currentColor"
                            d="M2.5 6.2v3.6c0 .4.3.7.7.7h1.7l2.6 2.1c.5.4 1.2 0 1.2-.6V4c0-.6-.7-1-1.2-.6L4.9 5.5H3.2c-.4 0-.7.3-.7.7Zm8.1.1a.7.7 0 0 1 1 0 2.6 2.6 0 0 1 0 3.4.7.7 0 1 1-1-.9 1.2 1.2 0 0 0 0-1.6.7.7 0 0 1 0-1Zm1.5-2.1a.7.7 0 0 1 1 0 5.4 5.4 0 0 1 0 7.6.7.7 0 1 1-1-1 4 4 0 0 0 0-5.6.7.7 0 0 1 0-1Z"
                          />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                  {row.note ? <p className="faaaaast-note">{row.note}</p> : null}
                </div>
              )
            )}
            {error ? (
              <p className="faaaaast-error">
                {error === 'no-key'
                  ? t(locale, 'faaaaast.noKey')
                  : error === 'empty'
                    ? t(locale, 'faaaaast.empty')
                    : t(locale, 'faaaaast.error')}
              </p>
            ) : null}
          </div>
        )}
        <div className="faaaaast-composer">
          <AgentBrandMark agent={{ id: mark.id, name: mark.name }} size={28} />
          <textarea
            ref={inputRef}
            className="faaaaast-input"
            data-testid="faaaaast-input"
            rows={1}
            value={text}
            placeholder={
              logging ? t(locale, 'faaaaast.followPlaceholder') : t(locale, 'faaaaast.placeholder')
            }
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  )
}
