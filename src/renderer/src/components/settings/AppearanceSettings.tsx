import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { Button, InlineAlert, Segmented, Toggle } from '../ui'
import { IS_MAC } from '../../lib/platform'

const MODIFIER_SYMBOL: Record<string, string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧'
}

/** The modifiers this keyboard actually has, for the "needs a modifier" hint. */
const MODIFIER_HINT = IS_MAC ? '⌘⌃⌥⇧' : 'Ctrl / Alt / Shift'

/**
 * Renders an Electron accelerator the way the platform writes it: "⌃⌘Space" on
 * macOS, "Ctrl+Alt+Space" on Windows.
 */
function prettyAccelerator(accelerator: string): string {
  if (!accelerator) return '未设置'
  const parts = accelerator.split('+')
  if (!IS_MAC) return parts.join('+')
  return parts.map((part) => MODIFIER_SYMBOL[part] ?? part).join('')
}

export function AppearanceSettings(): React.JSX.Element {
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)

  const [fonts, setFonts] = useState<string[]>([])
  const [recording, setRecording] = useState(false)
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)

  // Only offer fonts this machine can actually render.
  useEffect(() => {
    void window.vav.settings.availableFonts().then((candidates) => {
      const installed = candidates.filter((font) => {
        try {
          return document.fonts.check(`12px "${font}"`)
        } catch {
          return true
        }
      })
      setFonts(installed.length ? installed : candidates)
    })
  }, [])

  useEffect(() => {
    if (!recording) return
    const onKey = async (event: KeyboardEvent): Promise<void> => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(false)
        return
      }

      const modifiers: string[] = []
      if (event.ctrlKey) modifiers.push('Control')
      if (event.altKey) modifiers.push('Alt')
      if (event.shiftKey) modifiers.push('Shift')
      if (event.metaKey) modifiers.push('Command')

      const key = normalizeKey(event)
      if (!key) return
      if (modifiers.length === 0) {
        setHotkeyError(`至少需要一个修饰键（${MODIFIER_HINT}）`)
        return
      }

      const accelerator = [...modifiers, key].join('+')
      const response = await window.vav.settings.setHotkey(accelerator)
      setRecording(false)
      if (response.ok) {
        setHotkeyError(null)
        useSessionStore.setState({ settings: response.settings })
      } else {
        setHotkeyError('快捷键不可用，请换一组修饰键组合')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  return (
    <div className="form">
      <div className="form-row">
        <label>主题</label>
        <div className="control">
          <Segmented<ThemeMode>
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '暗色' },
              { value: 'system', label: '系统' }
            ]}
            value={settings.theme}
            onChange={(theme) => void updateSettings({ theme })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>代码 / 终端字体</label>
        <div className="control">
          <select
            className="text-field"
            value={settings.codeFont}
            onChange={(event) => void updateSettings({ codeFont: event.target.value })}
          >
            {fonts.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-hint" style={{ fontFamily: `"${settings.codeFont}", monospace` }}>
        Aa 0123 · 仅列出本机已安装字体
      </div>

      <div className="form-row">
        <label>字号</label>
        <div className="control">
          <input
            type="range"
            min={10}
            max={24}
            step={1}
            style={{ flex: 1 }}
            value={settings.fontSize}
            onChange={(event) => void updateSettings({ fontSize: Number(event.target.value) })}
          />
          <span className="muted" style={{ width: 42 }}>
            {settings.fontSize} pt
          </span>
        </div>
      </div>

      <div className="form-row">
        <label>减少动画</label>
        <div className="control">
          <Toggle
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => void updateSettings({ reduceMotion })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>全局呼出快捷键</label>
        <div className="control">
          <kbd>{recording ? '按下组合键…' : prettyAccelerator(settings.globalHotkey)}</kbd>
          <Button
            label={recording ? '取消' : '录制'}
            variant="secondary"
            size="sm"
            onClick={() => {
              setHotkeyError(null)
              setRecording(!recording)
            }}
          />
          {settings.globalHotkey && (
            <Button
              label="清除"
              size="sm"
              onClick={() => void window.vav.settings.setHotkey('').then((r) =>
                useSessionStore.setState({ settings: r.settings })
              )}
            />
          )}
        </div>
      </div>
      <div className="form-hint">
        在任意应用中按下即可呼出 / 隐藏 vav。需至少一个修饰键（{MODIFIER_HINT}）。
      </div>

      {hotkeyError && <InlineAlert kind="warning" title="快捷键不可用" message={hotkeyError} />}
    </div>
  )
}

/** Maps a DOM key event to the Electron accelerator key name. */
function normalizeKey(event: KeyboardEvent): string | null {
  const code = event.code
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Tab: 'Tab',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  }
  return named[code] ?? null
}
