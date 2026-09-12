import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { normalizeAccentHex, tintSwatchColor, type FixedColorTint } from '@shared/colorTints'
import {
  appearanceBaseForMachine,
  appearanceForMachine,
  patchMachineAppearance
} from '@shared/machineAppearance'
import { isLocalMachine, LOCAL_MACHINE_ID, serviceShortName, userFacingRemotes } from '@shared/workspaceHost'
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
import {
  UI_ZOOM_MAX_PERCENT,
  UI_ZOOM_MIN_PERCENT,
  UI_ZOOM_STEP_PERCENT,
  uiZoomFromPercent,
  uiZoomPercent
} from '@shared/uiZoom'
import { SURFACE_PATTERN_PRESETS } from '../../lib/surfacePatterns'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Segmented, Toggle } from '../ui'
import { IS_MAC } from '../../lib/platform'

export function AppearanceSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const focusAgentId = useSessionStore((s) => s.settingsFocusAgentId)
  const focusMachineId = useSessionStore((s) => s.settingsFocusMachineId)
  const systemAccent = useSessionStore((s) => s.systemAccentColor)
  const hosts = useSessionStore((s) => s.hosts)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const remotes = userFacingRemotes(hosts)
  const [themeMachineId, setThemeMachineId] = useState(windowMachineId || LOCAL_MACHINE_ID)
  useEffect(() => {
    setThemeMachineId(focusMachineId || windowMachineId || LOCAL_MACHINE_ID)
    if (focusMachineId) useSessionStore.setState({ settingsFocusMachineId: null })
  }, [focusMachineId, windowMachineId])
  useEffect(() => {
    const focusId =
      focusAgentId === 'screenshot'
        ? 'settings-screenshot'
        : focusAgentId === 'computer-use'
          ? 'settings-computer-use'
          : null
    if (!focusId) return
    document.getElementById(focusId)?.scrollIntoView({ block: 'center' })
    useSessionStore.setState({ settingsFocusAgentId: null })
  }, [focusAgentId])
  const [screenPermission, setScreenPermission] = useState<
    'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
  >('unknown')
  const [computerStatus, setComputerStatus] = useState<
    import('@shared/computerUse').ComputerUseStatus | null
  >(null)
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      if (IS_MAC) {
        void window.vav.files.screenshotPermission().then((status) => {
          if (alive) setScreenPermission(status)
        })
      }
      void window.vav.computer.status().then((status) => {
        if (alive) setComputerStatus(status)
      })
    }
    refresh()
    const later = window.setTimeout(refresh, 1600)
    // Re-check when the user returns after granting in System Settings.
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.clearTimeout(later)
      window.removeEventListener('focus', refresh)
    }
  }, [settings.computerUseEnabled])
  const themeTargets = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: serviceShortName(LOCAL_MACHINE_ID) },
      ...remotes.map((host) => ({
        id: host.id,
        name: serviceShortName(host.id, hosts, host.name)
      }))
    ],
    [hosts, remotes]
  )
  const machineLook = appearanceForMachine(
    settings,
    themeMachineId,
    appearanceBaseForMachine(settings, themeMachineId, hosts)
  )
  const persistLook = (patch: {
    theme?: ThemeMode
    colorTint?: (typeof settings)['colorTint']
    customAccentColor?: string
    surfacePattern?: SurfacePattern
  }): void => {
    if (themeTargets.length <= 1 || isLocalMachine(themeMachineId)) {
      void updateSettings(patch)
      return
    }
    void updateSettings({
      machineAppearances: patchMachineAppearance(
        settings.machineAppearances,
        themeMachineId,
        patch
      )
    })
  }
  const [patternError, setPatternError] = useState<string | null>(null)

  const [fonts, setFonts] = useState<string[]>([])
  // Match applied tokens (system theme follows OS, not the light-only swatch table).
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const mode = machineLook.theme
      setResolvedTheme(mode === 'system' ? (media.matches ? 'dark' : 'light') : mode)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [machineLook.theme])

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

  const customHex = normalizeAccentHex(machineLook.customAccentColor)
  const customActive = (machineLook.colorTint ?? 'system') === 'custom'
  const customLabel = customHex
    ? `${t('appearance.colorTint.custom')} · ${customHex}`
    : t('appearance.colorTint.custom')

  return (
    <div className="form">
      {themeTargets.length > 1 ? (
        <div className="form-row">
          <label htmlFor="settings-appearance-connection">{t('appearance.connectionTheme')}</label>
          <div className="control">
            <div className="font-select">
              <select
                id="settings-appearance-connection"
                className="text-field font-select-field"
                data-testid="settings-appearance-connection"
                value={themeMachineId}
                title={t('appearance.connectionTheme')}
                onChange={(event) => setThemeMachineId(event.target.value)}
              >
                {themeTargets.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
            </div>
          </div>
        </div>
      ) : null}
      <div className="form-hint">{t('appearance.connectionThemeHint')}</div>

      <div className="form-row">
        <label>{t('appearance.theme')}</label>
        <div className="control">
          <Segmented<ThemeMode>
            options={[
              { value: 'light', label: t('appearance.theme.light') },
              { value: 'dark', label: t('appearance.theme.dark') },
              { value: 'system', label: t('appearance.theme.system') }
            ]}
            value={machineLook.theme}
            onChange={(theme) => persistLook({ theme })}
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
              const active = (machineLook.colorTint ?? 'system') === tint
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
                  onClick={() => persistLook({ colorTint: tint })}
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
                if (machineLook.colorTint !== 'custom') {
                  persistLook({ colorTint: 'custom' })
                }
                const picked = await window.vav.settings.pickColor(customHex ?? undefined)
                if (!picked) return // cancelled — keep current selection
                const hex = normalizeAccentHex(picked)
                if (!hex) return
                persistLook({ colorTint: 'custom', customAccentColor: hex })
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
        <label htmlFor="settings-ui-zoom">{t('appearance.uiZoom')}</label>
        <div className="control">
          <input
            id="settings-ui-zoom"
            type="range"
            min={UI_ZOOM_MIN_PERCENT}
            max={UI_ZOOM_MAX_PERCENT}
            step={UI_ZOOM_STEP_PERCENT}
            style={{ flex: 1 }}
            value={uiZoomPercent(settings.uiZoom)}
            data-testid="settings-ui-zoom"
            onChange={(event) =>
              void updateSettings({ uiZoom: uiZoomFromPercent(event.target.value) })
            }
          />
          <span className="muted" style={{ width: 48 }}>
            {uiZoomPercent(settings.uiZoom)}%
          </span>
        </div>
      </div>
      <div className="form-hint">{t('appearance.uiZoomHint')}</div>

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

      <div className="form-row" id="settings-screenshot">
        <label>{t('appearance.screenshotKeepFront')}</label>
        <div className="control">
          <Toggle
            checked={settings.screenshotKeepWindowFront !== false}
            title={t('appearance.screenshotKeepFront')}
            testId="settings-screenshot-keep-front"
            onChange={(screenshotKeepWindowFront) =>
              void updateSettings({ screenshotKeepWindowFront })
            }
          />
        </div>
      </div>
      <div className="form-hint">{t('appearance.screenshotKeepFrontHint')}</div>

      {IS_MAC && (
        <>
          <div className="form-row" id="settings-screenshot-permission">
            <label>{t('appearance.screenshotPermission')}</label>
            <div className="control">
              {screenPermission === 'granted' ? (
                <span data-testid="settings-screenshot-permission-status">
                  {t('appearance.screenshotPermissionGranted')}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn ghost sm"
                  data-testid="settings-screenshot-authorize"
                  onClick={() => void window.vav.files.openScreenshotPermissionSettings()}
                >
                  {t('appearance.screenshotPermissionAuthorize')}
                </button>
              )}
            </div>
          </div>
          {screenPermission !== 'granted' && (
            <div className="form-hint">{t('appearance.screenshotPermissionHint')}</div>
          )}
        </>
      )}

      <div className="form-row" id="settings-computer-use">
        <label>{t('appearance.computerUse')}</label>
        <div className="control">
          <Toggle
            checked={settings.computerUseEnabled === true}
            title={t('appearance.computerUse')}
            testId="settings-computer-use"
            onChange={(computerUseEnabled) => void updateSettings({ computerUseEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('appearance.computerUseHint')}</div>
      {computerStatus && !computerStatus.binaryPresent && (
        <div className="form-hint">{t('appearance.computerUseBinaryMissing')}</div>
      )}
      {settings.computerUseEnabled && computerStatus && (
        <div className="form-hint">
          {computerStatus.running
            ? t('appearance.computerUseRunning')
            : computerStatus.error || t('appearance.computerUseStopped')}
        </div>
      )}
      {IS_MAC && (
        <>
          <div className="form-row" id="settings-accessibility-permission">
            <label>{t('appearance.accessibilityPermission')}</label>
            <div className="control">
              {computerStatus?.accessibility === 'granted' ? (
                <span>{t('appearance.screenshotPermissionGranted')}</span>
              ) : (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => {
                    void window.vav.computer.requestAccessibility().then((ok) => {
                      if (!ok) void window.vav.computer.openAccessibilitySettings()
                    })
                  }}
                >
                  {t('appearance.accessibilityPermissionAuthorize')}
                </button>
              )}
            </div>
          </div>
          {computerStatus?.accessibility !== 'granted' && (
            <div className="form-hint">{t('appearance.accessibilityPermissionHint')}</div>
          )}
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
              const active = (machineLook.surfacePattern ?? 'none') === preset.id
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
                    persistLook({ surfacePattern: preset.id as SurfacePattern })
                  }
                >
                  <span className="pattern-swatch-name">{name}</span>
                </button>
              )
            })}
            <button
              type="button"
              role="radio"
              aria-checked={(machineLook.surfacePattern ?? 'none') === 'custom'}
              className={`pattern-swatch is-custom${
                (machineLook.surfacePattern ?? 'none') === 'custom' ? ' is-active' : ''
              }${machineLook.customSurfacePatternUrl ? '' : ' is-empty'}`}
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
                machineLook.customSurfacePatternUrl
                  ? {
                      ['--surface-pattern-url' as string]: `url("${machineLook.customSurfacePatternUrl}")`,
                      ['--surface-pattern-size' as string]: swatchPatternSize(
                        machineLook.customSurfacePatternSize || '40px 40px'
                      )
                    }
                  : undefined
              }
              onClick={() => {
                void (async () => {
                  setPatternError(null)
                  const has = !!machineLook.customSurfacePatternUrl
                  if (has && machineLook.surfacePattern !== 'custom') {
                    persistLook({ surfacePattern: 'custom' })
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
