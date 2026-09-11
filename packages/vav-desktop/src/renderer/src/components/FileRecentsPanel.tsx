import { useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { FileSessionListEntry } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { basename, dirname } from '../lib/path'
import { relativeTime } from '../lib/format'
import { hostMachineLabel, uniqueRecentFileRows } from '../lib/sidebarList'
import { isLocalMachine, LOCAL_MACHINE_ID, normalizeMachineId } from '@shared/workspaceHost'
import {
  fileSessionSelectHint,
  openExistingFileSession,
  openPickedFileSessions
} from '../lib/openFileSession'
import { ShellLeadingControls } from './ShellLeadingControls'
import { Button } from './ui'
import { MachineFilesBrowser } from './filesPanel/MachineFilesBrowser'

export function FileRecentsPanel(): React.JSX.Element {
  const t = useT()
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const source = useSessionStore((s) => s.filesSource)
  const setFilesSource = useSessionStore((s) => s.setFilesSource)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const hosts = useSessionStore((s) => s.hosts)
  const machineLabel = isLocalMachine(windowMachineId)
    ? t('sidebar.thisMac')
    : hostMachineLabel(windowMachineId, hosts, LOCAL_MACHINE_ID, t('sidebar.thisMac'))
  const fileSessionKey = useSessionStore((s) =>
    s.conversations
      .filter((c) => c.fileId)
      .map((c) => `${c.id}:${c.updatedAt}`)
      .join('|')
  )
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !sidebarFloating)
  const [rows, setRows] = useState<FileSessionListEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const listed = await window.vav.fileSessions.listAll()
      setRows(uniqueRecentFileRows(listed))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [windowMachineId])

  useEffect(() => {
    void refresh()
  }, [refresh, fileSessionKey, windowMachineId])

  const openPicker = useCallback((): void => {
    void openPickedFileSessions().then((opened) => {
      if (opened) void refresh()
    })
  }, [refresh])

  return (
    <main className="detail" data-testid="file-recents">
      <header
        className={`terminal-host-chrome agent-mode-chrome${showShellLeading ? ' has-shell-leading' : ''}`}
      >
        <div className="agent-mode-chrome-row">
          {showShellLeading ? (
            <div className="agent-mode-shell-leading">
              <ShellLeadingControls />
            </div>
          ) : null}
          <div className="font-select file-source-select">
            <select
              className="text-field font-select-field"
              data-testid="file-source-select"
              aria-label={t('sidebar.filesSource')}
              value={source}
              onChange={(event) =>
                setFilesSource(event.target.value === 'thisMac' ? 'thisMac' : 'recent')
              }
            >
              <option value="recent">{t('sidebar.recentFiles')}</option>
              <option value="thisMac">{machineLabel}</option>
            </select>
            <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
          </div>
          <span className="spacer" />
          {source === 'recent' && isLocalMachine(windowMachineId) ? (
            <Button
              variant="secondary"
              size="sm"
              testId="open-a-file"
              title={t('sidebar.openAFile')}
              label={t('sidebar.openAFile')}
              onClick={openPicker}
            />
          ) : null}
        </div>
      </header>
      {source === 'thisMac' ? (
        <MachineFilesBrowser key={windowMachineId} />
      ) : (
        <div className="file-recents-body">
          <div className="file-recents-card">
            {loading ? null : rows.length === 0 ? (
              <p className="file-recents-empty">{t('sidebar.recentFilesEmpty')}</p>
            ) : (
              <ul className="inline-review-files file-recents-files">
                {rows.map((row) => {
                  const name = basename(row.path) || row.path
                  const folder = basename(dirname(row.path)) || dirname(row.path)
                  const missing =
                    row.pathStatus === 'dir_missing'
                      ? t('sidebar.dirNotExist')
                      : row.pathStatus === 'file_missing'
                        ? t('sidebar.fileNotExist')
                        : null
                  const meta = missing
                    ? `${folder} · ${missing}`
                    : `${folder} · ${relativeTime(row.updatedAt)}`
                  return (
                    <li key={row.path} className="inline-review-file" data-testid="file-recent-row">
                      <div className="inline-review-file-main">
                        <button
                          type="button"
                          className="inline-review-file-row"
                          title={row.path}
                          onClick={() =>
                            openExistingFileSession(
                              row.path,
                              row.sessionId,
                              fileSessionSelectHint(row)
                            )
                          }
                        >
                          <span className="inline-review-file-name">{name}</span>
                          <span className="inline-review-file-meta">{meta}</span>
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
