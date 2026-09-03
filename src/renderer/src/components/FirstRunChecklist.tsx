import { Check, Circle } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Empty-transcript checklist for the first workspace session: key, folder, send.
 * Dismissed into settings so it does not return after the user is set up.
 */
export function FirstRunChecklist({ conversationId }: { conversationId: string }): React.JSX.Element | null {
  const t = useT()
  const dismissed = useSessionStore((s) => s.settings.firstRunChecklistDismissed === true)
  const apiKeyPresent = useSessionStore((s) => s.settings.apiKeyPresent)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === conversationId))
  const workspaceRoot = useWorkspaceStore((s) => s.workspaces[conversationId]?.root ?? null)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const openSettings = useSessionStore((s) => s.openSettings)
  const pickWorkingDirectory = useSessionStore((s) => s.pickWorkingDirectory)

  if (dismissed) return null

  const hasFolder = Boolean(conversation?.workingDirectory || workspaceRoot)
  const items = [
    { id: 'key', done: apiKeyPresent, label: t('firstRun.apiKey') },
    { id: 'folder', done: hasFolder, label: t('firstRun.workspace') },
    { id: 'chat', done: false, label: t('firstRun.chat') }
  ]
  if (items.every((item) => item.done)) return null

  return (
    <div className="first-run-checklist" role="region" aria-label={t('firstRun.title')}>
      <div className="first-run-checklist-title">{t('firstRun.title')}</div>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.done ? 'is-done' : undefined}>
            {item.done ? (
              <Check size={14} strokeWidth={2.2} aria-hidden />
            ) : (
              <Circle size={14} strokeWidth={2} aria-hidden />
            )}
            {item.id === 'key' && !item.done ? (
              <button type="button" className="linkish" onClick={() => openSettings('agents', 'vav')}>
                {item.label}
              </button>
            ) : item.id === 'folder' && !item.done ? (
              <button type="button" className="linkish" onClick={() => void pickWorkingDirectory(conversationId)}>
                {item.label}
              </button>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ul>
      <Button
        label={t('firstRun.dismiss')}
        size="sm"
        onClick={() => void updateSettings({ firstRunChecklistDismissed: true })}
      />
    </div>
  )
}
