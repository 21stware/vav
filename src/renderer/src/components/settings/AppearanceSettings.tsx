import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'
import type { LocalePreference } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
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
function prettyAccelerator(accelerator: string, notSet: string): string {
  if (!accelerator) return notSet
  const parts = accelerator.split('+')
  if (!IS_MAC) return parts.join('+')
  return parts.map((part) => MODIFIER_SYMBOL[part] ?? part).join('')
}

export function AppearanceSettings(): React.JSX.Element {
  const t = useT()
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
        setHotkeyError(t('appearance.hotkeyNeedModifier', { modifiers: MODIFIER_HINT }))
        return
      }

      const accelerator = [...modifiers, key].join('+')
      const response = await window.vav.settings.setHotkey(accelerator)
      setRecording(false)
      if (response.ok) {
        setHotkeyError(null)
        useSessionStore.setState({ settings: response.settings })
      } else {
        setHotkeyError(t('appearance.hotkeyTaken'))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, t])

  return (
    <div className="form">
      <div className="form-row">
        <label>{t('appearance.theme')}</label>
        <div className="control">
          <Segmented<ThemeMode>
            options={[
              { value: 'light', label: t('appearance.theme.light') },
              { value: 'dark', label: t('appearance.theme.dark') },
              { value: 'system', label: t('appearance.theme.system') }
            ]}
            value={settings.theme}
            onChange={(theme) => void updateSettings({ theme })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('appearance.language')}</label>
        <div className="control">
          <Segmented<LocalePreference>
            options={[
              { value: 'system', label: t('appearance.language.system') },
              { value: 'zh-CN', label: t('appearance.language.zh') },
              { value: 'en', label: t('appearance.language.en') }
            ]}
            value={settings.locale}
            onChange={(locale) => void updateSettings({ locale })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('appearance.codeFont')}</label>
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
        {t('appearance.codeFontHint')}
      </div>

      <div className="form-row">
        <label>{t('appearance.fontSize')}</label>
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
        <label>{t('appearance.reduceMotion')}</label>
        <div className="control">
          <Toggle
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => void updateSettings({ reduceMotion })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('appearance.hotkey')}</label>
        <div className="control">
          <kbd>
            {recording
              ? t('appearance.hotkeyRecording')
              : prettyAccelerator(settings.globalHotkey, t('common.notSet'))}
          </kbd>
          <Button
            label={recording ? t('common.cancel') : t('common.record')}
            variant="secondary"
            size="sm"
            onClick={() => {
              setHotkeyError(null)
              setRecording(!recording)
            }}
          />
          {settings.globalHotkey && (
            <Button
              label={t('appearance.hotkeyClear')}
              size="sm"
              onClick={() =>
                void window.vav.settings.setHotkey('').then((r) =>
                  useSessionStore.setState({ settings: r.settings })
                )
              }
            />
          )}
        </div>
      </div>
      <div className="form-hint">
        {t('appearance.hotkeyHint', { modifiers: MODIFIER_HINT })}
      </div>

      {/* `hotkeyError` already opens with what went wrong, so a heading here
          repeated its first four characters back at the reader. */}
      {hotkeyError && <InlineAlert kind="warning" message={hotkeyError} />}
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
