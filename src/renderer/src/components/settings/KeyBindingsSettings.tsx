import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  KEY_BINDING_DEFS,
  KEY_BINDING_GROUP_LABEL,
  acceleratorFromEvent,
  defaultAccelerator,
  findKeyBindingConflict,
  prettyAccelerator,
  resolveKeyBindings,
  type AcceleratorKeyBindingId,
  type KeyBindingDef,
  type KeyBindingGroupId,
  type KeyBindingId
} from '@shared/keyBindings'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, InlineAlert, Segmented } from '../ui'
import { defaultHotkey } from '@shared/platform'
import { IS_MAC, PLATFORM, keys } from '../../lib/platform'

const MODIFIER_HINT = IS_MAC ? '⌘⌃⌥⇧' : 'Ctrl / Alt / Shift'

const GROUP_ORDER: KeyBindingGroupId[] = [
  'special',
  'session',
  'chrome',
  'find',
  'terminal',
  'focus',
  'files'
]

function KeyRow({
  label,
  chord,
  actions,
  hint
}: {
  label: string
  chord: ReactNode
  actions?: ReactNode
  hint?: ReactNode
}): React.JSX.Element {
  return (
    <div className="keybind-row">
      <div className="keybind-label" title={label}>
        {label}
      </div>
      <div className="keybind-chord">{chord}</div>
      <div className="keybind-actions">{actions}</div>
      {hint ? <div className="keybind-hint">{hint}</div> : null}
    </div>
  )
}

/**
 * Settings → Key Bindings — list + rebind every product accelerator.
 * Send key and global hotkey live here (moved out of Appearance).
 */
export function KeyBindingsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)

  const [recordingId, setRecordingId] = useState<KeyBindingId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bindings = useMemo(
    () => resolveKeyBindings(settings.keyBindings),
    [settings.keyBindings]
  )

  const groups = useMemo(() => {
    const map = new Map<KeyBindingGroupId, KeyBindingDef[]>()
    for (const def of KEY_BINDING_DEFS) {
      if (def.macOnly && !IS_MAC) continue
      const list = map.get(def.group) ?? []
      list.push(def)
      map.set(def.group, list)
    }
    return GROUP_ORDER.map((id) => ({ id, defs: map.get(id) ?? [] })).filter(
      (g) => g.defs.length > 0
    )
  }, [])

  useEffect(() => {
    if (!recordingId || recordingId === 'sendKey' || recordingId === 'quickLook') return

    const onKey = async (event: KeyboardEvent): Promise<void> => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecordingId(null)
        return
      }

      const accelerator = acceleratorFromEvent(event, PLATFORM)
      if (!accelerator) {
        setError(t('appearance.hotkeyNeedModifier', { modifiers: MODIFIER_HINT }))
        return
      }

      if (recordingId === 'globalHotkey') {
        const conflict = findKeyBindingConflict(
          accelerator,
          'globalHotkey',
          bindings,
          '',
          PLATFORM
        )
        if (conflict) {
          const label = labelForConflict(conflict)
          setError(t('keybindings.conflict', { label }))
          setRecordingId(null)
          return
        }
        const response = await window.vav.settings.setHotkey(accelerator)
        setRecordingId(null)
        if (response.ok) {
          setError(null)
          useSessionStore.setState({ settings: response.settings })
        } else {
          setError(t('appearance.hotkeyTaken'))
        }
        return
      }

      const id = recordingId as AcceleratorKeyBindingId
      const conflict = findKeyBindingConflict(
        accelerator,
        id,
        bindings,
        settings.globalHotkey,
        PLATFORM
      )
      if (conflict) {
        const label = labelForConflict(conflict)
        setError(t('keybindings.conflict', { label }))
        setRecordingId(null)
        return
      }

      const next = { ...settings.keyBindings }
      if (accelerator === defaultAccelerator(id)) delete next[id]
      else next[id] = accelerator
      setRecordingId(null)
      setError(null)
      void updateSettings({ keyBindings: next })
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)

    function labelForConflict(conflictId: KeyBindingId): string {
      if (conflictId === 'globalHotkey') return t('appearance.hotkey')
      const def = KEY_BINDING_DEFS.find((d) => d.id === conflictId)
      return def ? t(def.labelKey) : conflictId
    }
  }, [
    recordingId,
    bindings,
    settings.globalHotkey,
    settings.keyBindings,
    t,
    updateSettings
  ])

  const platformDefaultHotkey = defaultHotkey(PLATFORM)
  const hasOverrides =
    Object.keys(settings.keyBindings ?? {}).length > 0 ||
    settings.globalHotkey !== platformDefaultHotkey ||
    settings.sendKey !== 'enter'

  return (
    <div className="keybind-panel">
      <div className="keybind-toolbar">
        <p className="keybind-intro">{t('keybindings.intro')}</p>
        <Button
          label={t('keybindings.resetAll')}
          size="sm"
          disabled={!hasOverrides}
          onClick={() => {
            setError(null)
            setRecordingId(null)
            void updateSettings({ keyBindings: {}, sendKey: 'enter' })
            void window.vav.settings.setHotkey(platformDefaultHotkey).then((r) => {
              if (r.ok) useSessionStore.setState({ settings: r.settings })
            })
          }}
        />
      </div>

      {error && <InlineAlert kind="warning" message={error} />}

      {groups.map(({ id, defs }) => (
        <section key={id} className="keybind-group">
          <div className="settings-section-title">{t(KEY_BINDING_GROUP_LABEL[id])}</div>
          <div className="keybind-list">
            {defs.map((def) => {
              if (def.kind === 'sendKey') {
                return (
                  <KeyRow
                    key={def.id}
                    label={t(def.labelKey)}
                    chord={
                      <Segmented<'enter' | 'mod-enter'>
                        options={[
                          { value: 'enter', label: t('appearance.sendKey.enter') },
                          { value: 'mod-enter', label: keys('⌘↵') }
                        ]}
                        value={settings.sendKey === 'mod-enter' ? 'mod-enter' : 'enter'}
                        onChange={(sendKey) => void updateSettings({ sendKey })}
                      />
                    }
                    hint={t('appearance.sendKeyHint', {
                      mod: keys('⌘↵'),
                      enter: keys('↵')
                    })}
                  />
                )
              }

              if (def.kind === 'globalHotkey') {
                const recording = recordingId === 'globalHotkey'
                return (
                  <KeyRow
                    key={def.id}
                    label={t(def.labelKey)}
                    chord={
                      <kbd>
                        {recording
                          ? t('appearance.hotkeyRecording')
                          : prettyAccelerator(
                              settings.globalHotkey,
                              PLATFORM,
                              t('common.notSet')
                            )}
                      </kbd>
                    }
                    actions={
                      <>
                        <Button
                          label={recording ? t('common.cancel') : t('common.record')}
                          size="sm"
                          onClick={() => {
                            setError(null)
                            setRecordingId(recording ? null : 'globalHotkey')
                          }}
                        />
                        {settings.globalHotkey ? (
                          <Button
                            label={t('appearance.hotkeyClear')}
                            size="sm"
                            onClick={() =>
                              void window.vav.settings.setHotkey('').then((r) => {
                                if (r.ok) useSessionStore.setState({ settings: r.settings })
                              })
                            }
                          />
                        ) : null}
                      </>
                    }
                    hint={t('appearance.hotkeyHint', { modifiers: MODIFIER_HINT })}
                  />
                )
              }

              if (def.kind === 'readonly') {
                return (
                  <KeyRow
                    key={def.id}
                    label={t(def.labelKey)}
                    chord={
                      <kbd>{prettyAccelerator(def.defaultAccelerator, PLATFORM)}</kbd>
                    }
                    actions={
                      <span className="keybind-readonly">{t('keybindings.readonlyHint')}</span>
                    }
                  />
                )
              }

              const accelId = def.id as AcceleratorKeyBindingId
              const current = bindings[accelId]
              const isDefault = current === defaultAccelerator(accelId)
              const recording = recordingId === accelId

              return (
                <KeyRow
                  key={def.id}
                  label={t(def.labelKey)}
                  chord={
                    <kbd>
                      {recording
                        ? t('appearance.hotkeyRecording')
                        : prettyAccelerator(current, PLATFORM)}
                    </kbd>
                  }
                  actions={
                    <>
                      <Button
                        label={recording ? t('common.cancel') : t('common.record')}
                        size="sm"
                        onClick={() => {
                          setError(null)
                          setRecordingId(recording ? null : accelId)
                        }}
                      />
                      {!isDefault ? (
                        <Button
                          label={t('keybindings.reset')}
                          size="sm"
                          onClick={() => {
                            const next = { ...settings.keyBindings }
                            delete next[accelId]
                            setError(null)
                            void updateSettings({ keyBindings: next })
                          }}
                        />
                      ) : null}
                    </>
                  }
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
