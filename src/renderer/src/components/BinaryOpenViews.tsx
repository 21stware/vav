/**
 * Ephemeral text / hex override for unsupported (binary) files.
 * Mode is owned by the parent — never persisted across opens.
 *
 * Both views auto-fill only a soft byte window (512 KB), then load further
 * chunks on scroll — never pull multi-GB files into a single React string.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/useT'

const TEXT_CHUNK = 256 * 1024
const HEX_CHUNK = 64 * 1024
/** Auto progressive fill ceiling; further bytes load on scroll. */
const AUTO_FILL_CAP = 512 * 1024

export type BinaryOpenMode = 'text' | 'hex'

export function BinaryOpenToolbar({
  mode,
  onMode
}: {
  mode: BinaryOpenMode | null
  onMode: (mode: BinaryOpenMode | null) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="binary-open-toolbar" role="toolbar" aria-label={t('preview.openAsToolbar')}>
      <button
        type="button"
        className={`binary-open-tab${mode === null ? ' active' : ''}`}
        onClick={() => onMode(null)}
      >
        {t('preview.openAsInfo')}
      </button>
      <button
        type="button"
        className={`binary-open-tab${mode === 'text' ? ' active' : ''}`}
        onClick={() => onMode('text')}
      >
        {t('preview.openAsText')}
      </button>
      <button
        type="button"
        className={`binary-open-tab${mode === 'hex' ? ' active' : ''}`}
        onClick={() => onMode('hex')}
      >
        {t('preview.openAsHex')}
      </button>
    </div>
  )
}

/** Force-open a binary path as UTF-8 text (lossy). Progressive window fill. */
export function ForcedBinaryTextView({ path }: { path: string }): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<{ endByte: number; totalBytes: number } | null>(null)
  const fillRef = useRef<{ endByte: number; totalBytes: number; busy: boolean } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const extend = useCallback(async (opts?: { force?: boolean }): Promise<void> => {
    const state = fillRef.current
    if (!state || state.busy) return
    if (state.endByte >= state.totalBytes) return
    // Cap idle auto-fill; scroll path passes force to continue past the soft ceiling.
    if (!opts?.force && state.endByte >= AUTO_FILL_CAP) return
    state.busy = true
    try {
      const win = await window.vav.files.readTextWindow(path, {
        startByte: state.endByte,
        maxBytes: TEXT_CHUNK,
        force: true
      })
      if (win.error) {
        setError(win.error)
        return
      }
      if (win.content) setText((prev) => prev + win.content)
      state.endByte = win.endByte
      state.totalBytes = win.totalBytes
      setMeta({ endByte: win.endByte, totalBytes: win.totalBytes })
      if (win.truncated && win.endByte < win.totalBytes && win.endByte < AUTO_FILL_CAP) {
        state.busy = false
        const schedule =
          typeof requestIdleCallback === 'function'
            ? (fn: () => void) => requestIdleCallback(() => fn(), { timeout: 120 })
            : (fn: () => void) => window.setTimeout(fn, 0)
        schedule(() => {
          if (fillRef.current === state) void extend()
        })
        return
      }
    } finally {
      if (fillRef.current === state) state.busy = false
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    let cancelled = false
    setText('')
    setError(null)
    setLoading(true)
    setMeta(null)
    fillRef.current = null
    void (async () => {
      const win = await window.vav.files.readTextWindow(path, {
        startByte: 0,
        maxBytes: TEXT_CHUNK,
        force: true
      })
      if (cancelled) return
      if (win.error) {
        setError(win.error)
        setLoading(false)
        return
      }
      setText(win.content)
      fillRef.current = {
        endByte: win.endByte,
        totalBytes: win.totalBytes,
        busy: false
      }
      setMeta({ endByte: win.endByte, totalBytes: win.totalBytes })
      setLoading(false)
      if (win.truncated && win.endByte < AUTO_FILL_CAP) void extend()
    })()
    return () => {
      cancelled = true
      fillRef.current = null
    }
  }, [path, extend])

  const onScroll = (): void => {
    const el = wrapRef.current
    const state = fillRef.current
    if (!el || !state || state.busy) return
    if (state.endByte >= state.totalBytes) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      void extend({ force: true })
    }
  }

  if (error) {
    return <div className="office-native-status error" style={{ margin: 16 }}>{error}</div>
  }

  return (
    <div className="binary-open-body" data-pad="text" ref={wrapRef} onScroll={onScroll}>
      {loading && !text ? (
        <div className="muted" style={{ padding: 16 }}>
          {t('common.loading')}
        </div>
      ) : (
        <>
          {/* Plain text — no hljs pass over multi-MB buffers. */}
          <pre className="file-viewer-code binary-force-text">
            <code>{text}</code>
          </pre>
          {meta && meta.endByte < meta.totalBytes ? (
            <div className="muted tiny binary-hex-more">
              {t('preview.hexWindowHint', {
                loaded: meta.endByte.toLocaleString(),
                total: meta.totalBytes.toLocaleString()
              })}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/** Classic hex dump with progressive byte windows. */
export function HexDumpView({ path }: { path: string }): React.JSX.Element {
  const t = useT()
  const [dump, setDump] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<{ endByte: number; totalBytes: number } | null>(null)
  const fillRef = useRef<{ endByte: number; totalBytes: number; busy: boolean } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const extend = useCallback(async (opts?: { force?: boolean }): Promise<void> => {
    const state = fillRef.current
    if (!state || state.busy) return
    if (state.endByte >= state.totalBytes) return
    if (!opts?.force && state.endByte >= AUTO_FILL_CAP) return
    state.busy = true
    try {
      const win = await window.vav.files.readBinaryWindow(path, {
        startByte: state.endByte,
        maxBytes: HEX_CHUNK
      })
      if (!win.ok) {
        setError(win.error)
        return
      }
      if (win.base64) {
        const bytes = base64ToBytes(win.base64)
        const chunk = formatHexDump(bytes, win.startByte)
        setDump((prev) => (prev ? `${prev}\n${chunk}` : chunk))
      }
      state.endByte = win.endByte
      state.totalBytes = win.totalBytes
      setMeta({ endByte: win.endByte, totalBytes: win.totalBytes })
      if (win.truncated && win.endByte < win.totalBytes && win.endByte < AUTO_FILL_CAP) {
        state.busy = false
        const schedule =
          typeof requestIdleCallback === 'function'
            ? (fn: () => void) => requestIdleCallback(() => fn(), { timeout: 120 })
            : (fn: () => void) => window.setTimeout(fn, 0)
        schedule(() => {
          if (fillRef.current === state) void extend()
        })
        return
      }
    } finally {
      if (fillRef.current === state) state.busy = false
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    let cancelled = false
    setDump('')
    setError(null)
    setLoading(true)
    setMeta(null)
    fillRef.current = null
    void (async () => {
      const win = await window.vav.files.readBinaryWindow(path, {
        startByte: 0,
        maxBytes: HEX_CHUNK
      })
      if (cancelled) return
      if (!win.ok) {
        setError(win.error)
        setLoading(false)
        return
      }
      const bytes = win.base64 ? base64ToBytes(win.base64) : new Uint8Array()
      setDump(formatHexDump(bytes, win.startByte))
      fillRef.current = {
        endByte: win.endByte,
        totalBytes: win.totalBytes,
        busy: false
      }
      setMeta({ endByte: win.endByte, totalBytes: win.totalBytes })
      setLoading(false)
      if (win.truncated && win.endByte < AUTO_FILL_CAP) void extend()
    })()
    return () => {
      cancelled = true
      fillRef.current = null
    }
  }, [path, extend])

  const onScroll = (): void => {
    const el = wrapRef.current
    const state = fillRef.current
    if (!el || !state || state.busy) return
    if (state.endByte >= state.totalBytes) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      void extend({ force: true })
    }
  }

  if (error) {
    return <div className="office-native-status error" style={{ margin: 16 }}>{error}</div>
  }

  return (
    <div className="binary-open-body hex" ref={wrapRef} onScroll={onScroll}>
      {loading && !dump ? (
        <div className="muted" style={{ padding: 16 }}>
          {t('common.loading')}
        </div>
      ) : (
        <>
          <pre className="file-viewer-code binary-hex-dump">{dump}</pre>
          {meta && meta.endByte < meta.totalBytes ? (
            <div className="muted tiny binary-hex-more">
              {t('preview.hexWindowHint', {
                loaded: meta.endByte.toLocaleString(),
                total: meta.totalBytes.toLocaleString()
              })}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Classic 16-byte hex dump lines. */
export function formatHexDump(bytes: Uint8Array, baseOffset: number): string {
  if (bytes.length === 0) return ''
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const end = Math.min(i + 16, bytes.length)
    const offset = (baseOffset + i).toString(16).padStart(8, '0')
    const left: string[] = []
    const right: string[] = []
    let ascii = ''
    for (let j = 0; j < 16; j++) {
      if (i + j < end) {
        const b = bytes[i + j]!
        const cell = b.toString(16).padStart(2, '0')
        if (j < 8) left.push(cell)
        else right.push(cell)
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'
      } else {
        if (j < 8) left.push('  ')
        else right.push('  ')
        ascii += ' '
      }
    }
    while (left.length < 8) left.push('  ')
    while (right.length < 8) right.push('  ')
    lines.push(`${offset}  ${left.join(' ')}  ${right.join(' ')}  |${ascii}|`)
  }
  return lines.join('\n')
}
