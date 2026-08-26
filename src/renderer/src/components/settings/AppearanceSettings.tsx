import { useEffect, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { normalizeAccentHex, tintSwatchColor, type FixedColorTint } from '@shared/colorTints'
import {
  PRESET_COLOR_TINTS,
  DISPLAY_CURRENCIES,
  type BashBackgroundMode,
  type DisplayCurrency,
  type LocalePreference,
  type SurfacePattern,
  type ThemeMode
} from '@shared/types'
import { swatchPatternSize } from '@shared/surfacePattern'
import { SURFACE_PATTERN_PRESETS } from '../../lib/surfacePatterns'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Segmented, Toggle } from '../ui'
import { IS_MAC } from '../../lib/platform'

export function AppearanceSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const systemAccent = useSessionStore((s) => s.systemAccentColor)
  const [patternError, setPatternError] = useState<string | null>(null)

  const [fonts, setFonts] = useState<string[]>([])
  // Match applied tokens (system theme follows OS, not the light-only swatch table).
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const mode = settings.theme
      setResolvedTheme(mode === 'system' ? (media.matches ? 'dark' : 'light') : mode)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

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

  const customHex = normalizeAccentHex(settings.customAccentColor)
  const customActive = (settings.colorTint ?? 'system') === 'custom'
  const customLabel = customHex
    ? `${t('appearance.colorTint.custom')} · ${customHex}`
    : t('appearance.colorTint.custom')

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
        <label>{t('appearance.bashBackground')}</label>
        <div className="control">
          <Segmented<BashBackgroundMode>
            options={[
              { value: 'dark', label: t('appearance.bashBackground.dark') },
              { value: 'theme', label: t('appearance.bashBackground.theme') }
            ]}
            value={settings.bashBackground ?? 'theme'}
            onChange={(bashBackground) => void updateSettings({ bashBackground })}
          />
        </div>
      </div>
      <div className="form-hint">{t('appearance.bashBackgroundHint')}</div>

      <div className="form-row">
        <label>{t('appearance.colorTint')}</label>
        <div className="control">
          <div className="tint-swatches" role="radiogroup" aria-label={t('appearance.colorTint')}>
            {PRESET_COLOR_TINTS.map((tint) => {
              const active = (settings.colorTint ?? 'system') === tint
              // Same hex (or mono gradient) that appearance.ts applies for this theme.
              const swatch =
                tint === 'system'
                  ? systemAccent || '#007aff'
                  : tintSwatchColor(tint as FixedColorTint, resolvedTheme)
              return (
                <button
                  key={tint}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`tint-swatch${active ? ' is-active' : ''}${
                    tint === 'mono' ? ' is-mono' : ''
                  }${tint === 'system' ? ' is-system' : ''}`}
                  title={t(`appearance.colorTint.${tint}`)}
                  aria-label={t(`appearance.colorTint.${tint}`)}
                  style={{ ['--tint-swatch' as string]: swatch }}
                  onClick={() => void updateSettings({ colorTint: tint })}
                />
              )
            })}
            <button
              type="button"
              role="radio"
              aria-checked={customActive}
              className={`tint-swatch is-custom${customActive ? ' is-active' : ''}${
                customHex ? '' : ' is-empty'
              }`}
              title={customLabel}
              aria-label={customLabel}
              style={customHex ? { ['--tint-swatch' as string]: customHex } : undefined}
              onClick={async () => {
                // Select "custom" immediately so the swatch shows as active
                // while the picker is open.
                if (settings.colorTint !== 'custom') {
                  void updateSettings({ colorTint: 'custom' })
                }
                const picked = await window.vav.settings.pickColor(customHex ?? undefined)
                if (!picked) return // cancelled — keep current selection
                const hex = normalizeAccentHex(picked)
                if (!hex) return
                void updateSettings({ colorTint: 'custom', customAccentColor: hex })
              }}
            >
              {customHex ? (
                <span className="tint-custom-fill" aria-hidden />
              ) : (
                <Plus className="tint-custom-plus" size={12} strokeWidth={2.5} aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="form-hint">{t('appearance.colorTintHint')}</div>

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
        <label>{t('appearance.currency')}</label>
        <div className="control">
          <div className="font-select">
            <select
              className="text-field font-select-field"
              value={settings.displayCurrency ?? 'USD'}
              onChange={(event) =>
                void updateSettings({ displayCurrency: event.target.value as DisplayCurrency })
              }
            >
              {DISPLAY_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {t(`appearance.currency.${code}`)}
                </option>
              ))}
            </select>
            <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
          </div>
        </div>
      </div>
      <div className="form-hint">{t('appearance.currencyHint')}</div>

      <div className="form-row">
        <label>{t('appearance.codeFont')}</label>
        <div className="control">
          <div className="font-select">
            <select
              className="text-field font-select-field"
              value={settings.codeFont}
              title={settings.codeFont}
              style={{ fontFamily: `"${settings.codeFont}", ui-monospace, monospace` }}
              onChange={(event) => void updateSettings({ codeFont: event.target.value })}
            >
              {fonts.map((font) => (
                <option
                  key={font}
                  value={font}
                  style={{ fontFamily: `"${font}", ui-monospace, monospace` }}
                >
                  {font}
                </option>
              ))}
            </select>
            <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
          </div>
        </div>
      </div>
      <div className="form-hint font-preview-hint">
        <span
          className="font-preview-sample"
          style={{ fontFamily: `"${settings.codeFont}", ui-monospace, monospace` }}
        >
          {t('appearance.codeFontSample')}
        </span>
        <span className="font-preview-sep" aria-hidden>
          ·
        </span>
        <span className="font-preview-meta">{t('appearance.codeFontMeta')}</span>
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
            title={t('appearance.reduceMotion')}
            testId="settings-reduce-motion"
            onChange={(reduceMotion) => void updateSettings({ reduceMotion })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('appearance.previewSelectionAgentMark')}</label>
        <div className="control">
          <Toggle
            checked={settings.previewSelectionAgentMark !== false}
            title={t('appearance.previewSelectionAgentMark')}
            onChange={(previewSelectionAgentMark) =>
              void updateSettings({ previewSelectionAgentMark })
            }
          />
        </div>
      </div>
      <div className="form-hint">{t('appearance.previewSelectionAgentMarkHint')}</div>

      <div className="form-row">
        <label>{t('appearance.previewReadModeSelection')}</label>
        <div className="control">
          <Toggle
            checked={settings.previewReadModeSelection !== false}
            title={t('appearance.previewReadModeSelection')}
            onChange={(previewReadModeSelection) =>
              void updateSettings({ previewReadModeSelection })
            }
          />
        </div>
      </div>
      <div className="form-hint">{t('appearance.previewReadModeSelectionHint')}</div>

      {IS_MAC && (
        <>
          <div className="form-row">
            <label>{t('appearance.windowVibrancy')}</label>
            <div className="control">
              <Toggle
                checked={settings.windowVibrancyEnabled !== false}
                title={t('appearance.windowVibrancy')}
                onChange={(windowVibrancyEnabled) =>
                  void updateSettings({ windowVibrancyEnabled })
                }
              />
            </div>
          </div>
          <div className="form-hint">{t('appearance.windowVibrancyHint')}</div>
        </>
      )}

      <div className="form-row form-row-patterns">
        <label>{t('appearance.surfacePattern')}</label>
        <div className="control">
          <div
            className="pattern-swatches"
            role="radiogroup"
            aria-label={t('appearance.surfacePattern')}
          >
            {SURFACE_PATTERN_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => {
              const active = (settings.surfacePattern ?? 'none') === preset.id
              const name = t(`appearance.surfacePattern.${preset.id}`)
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`pattern-swatch${active ? ' is-active' : ''}`}
                  data-pattern={preset.id}
                  title={name}
                  aria-label={name}
                  style={
                    preset.url
                      ? {
                          ['--surface-pattern-url' as string]: `url("${preset.url}")`,
                          ['--surface-pattern-size' as string]: swatchPatternSize(preset.size)
                        }
                      : undefined
                  }
                  onClick={() =>
                    void updateSettings({ surfacePattern: preset.id as SurfacePattern })
                  }
                >
                  <span className="pattern-swatch-name">{name}</span>
                </button>
              )
            })}
            <button
              type="button"
              role="radio"
              aria-checked={(settings.surfacePattern ?? 'none') === 'custom'}
              className={`pattern-swatch is-custom${
                (settings.surfacePattern ?? 'none') === 'custom' ? ' is-active' : ''
              }${settings.customSurfacePatternUrl ? '' : ' is-empty'}`}
              data-pattern="custom"
              title={
                settings.customSurfacePatternUrl
                  ? t('appearance.surfacePattern.custom')
                  : t('appearance.surfacePattern.customEmpty')
              }
              aria-label={
                settings.customSurfacePatternUrl
                  ? t('appearance.surfacePattern.custom')
                  : t('appearance.surfacePattern.customEmpty')
              }
              style={
                settings.customSurfacePatternUrl
                  ? {
                      ['--surface-pattern-url' as string]: `url("${settings.customSurfacePatternUrl}")`,
                      ['--surface-pattern-size' as string]: swatchPatternSize(
                        settings.customSurfacePatternSize || '40px 40px'
                      )
                    }
                  : undefined
              }
              onClick={() => {
                void (async () => {
                  setPatternError(null)
                  const has = !!settings.customSurfacePatternUrl
                  if (has && settings.surfacePattern !== 'custom') {
                    void updateSettings({ surfacePattern: 'custom' })
                    return
                  }
                  const picked = await window.vav.settings.pickSurfacePatternImage()
                  if (!picked) return
                  if (!picked.ok) {
                    setPatternError(
                      t(
                        picked.reason === 'no-alpha'
                          ? 'appearance.surfacePattern.needAlpha'
                          : 'appearance.surfacePattern.invalid'
                      )
                    )
                  }
                })()
              }}
            >
              <span className="pattern-swatch-name">{t('appearance.surfacePattern.custom')}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="form-hint">
        {t('appearance.surfacePatternHint')} {t('appearance.surfacePattern.customHint')}
      </div>
      {patternError ? (
        <div className="form-hint accounts-error" role="alert">
          {patternError}
        </div>
      ) : null}
    </div>
  )
}
