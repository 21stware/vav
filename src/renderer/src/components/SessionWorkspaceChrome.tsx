import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GitSnapshot } from '@shared/git'
import { useSessionStore } from '../state/sessionStore'
import { useT, tt } from '../i18n/useT'
import { isTemporaryWorkspace, workdirShortLabel } from '../lib/format'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { Button } from './ui'

type CreateForm =
  | { kind: 'branch'; name: string }
  | { kind: 'worktree'; branch: string; path: string; switchAfter: boolean }

function defaultWorktreePath(
  snap: GitSnapshot,
  cwd: string,
  branch: string
): string {
  const primary = snap.worktrees.find((w) => w.isPrimary)?.path ?? snap.toplevel ?? cwd
  const slug = branch
    .replace(/[^A-Za-z0-9._\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${primary.replace(/[/\\][^/\\]+$/, '')}/${snap.projectName ?? 'repo'}-${slug || 'worktree'}`
}

function TextBtn({
  children,
  disabled,
  title,
  onClick
}: {
  children: ReactNode
  disabled?: boolean
  title?: string
  onClick: (el: HTMLElement) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="session-workspace-text-btn"
      disabled={disabled}
      title={title}
      onClick={(e) => onClick(e.currentTarget)}
    >
      {children}
    </button>
  )
}

/**
 * Empty-session project chrome — prose lines with inline text actions.
 * Git → worktree / branch + create; non-git → enable version control.
 */
export function SessionWorkspaceChrome(): React.JSX.Element | null {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const tmp = useSessionStore((s) => s.tmp)
  const showDialog = useSessionStore((s) => s.showDialog)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)

  const cwd = conversation?.workingDirectory ?? null
  const temporary = isTemporaryWorkspace(cwd, tmp)

  const [snap, setSnap] = useState<GitSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CreateForm | null>(null)
  /** True only until the first status result for this cwd — avoids swapping chrome and replaying empty-state motion. */
  const [initialLoad, setInitialLoad] = useState(true)
  const cwdRef = useRef(cwd)
  const formInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (): Promise<GitSnapshot | null> => {
    if (!cwd) {
      setSnap(null)
      setInitialLoad(false)
      return null
    }
    if (!window.vav?.git?.status) {
      setSnap(null)
      setError(tt('git.apiMissing'))
      setInitialLoad(false)
      return null
    }
    setError(null)
    try {
      // Temp dirs can become repos after “enable version control”.
      const next = await window.vav.git.status(cwd)
      setSnap(next)
      if (next.error) setError(next.error)
      return next
    } catch (err) {
      setSnap(null)
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setInitialLoad(false)
    }
  }, [cwd])

  useEffect(() => {
    if (cwdRef.current !== cwd) {
      cwdRef.current = cwd
      setSnap(null)
      setInitialLoad(true)
      setError(null)
      setForm(null)
    }
    void refresh()
  }, [refresh, cwd])

  useEffect(() => {
    if (!form) return
    formInputRef.current?.focus()
    formInputRef.current?.select()
  }, [form?.kind])

  if (!activeId || !cwd) return null

  const projectName = snap?.isRepo
    ? snap.projectName
    : temporary
      ? t('sidebar.defaultWorkspace')
      : workdirShortLabel(cwd, tmp)

  const initRepo = async (): Promise<void> => {
    if (!cwd || !window.vav?.git?.init) {
      setError(t('git.apiMissing'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.vav.git.init(cwd)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSnap(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openBranchForm = (): void => {
    window.setTimeout(() => setForm({ kind: 'branch', name: '' }), 0)
  }

  const openWorktreeForm = (): void => {
    if (!snap?.isRepo || !cwd) return
    window.setTimeout(() => {
      setForm({
        kind: 'worktree',
        branch: '',
        path: defaultWorktreePath(snap, cwd, ''),
        switchAfter: true
      })
    }, 0)
  }

  const submitCreate = async (): Promise<void> => {
    if (!form || !cwd) return

    if (form.kind === 'branch') {
      const trimmed = form.name.trim()
      if (!trimmed) return
      if (!window.vav?.git?.createBranch) {
        setError(t('git.apiMissing'))
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await window.vav.git.createBranch(cwd, trimmed, { checkout: true })
        if (!result.ok) {
          showDialog({
            title: t('git.createBranchFailed'),
            body: result.error,
            confirmLabel: t('common.ok')
          })
          return
        }
        setForm(null)
        await refresh()
      } finally {
        setBusy(false)
      }
      return
    }

    if (!snap?.isRepo) return
    const trimmedBranch = form.branch.trim()
    if (!trimmedBranch) return
    const path = form.path.trim() || defaultWorktreePath(snap, cwd, trimmedBranch)
    if (!window.vav?.git?.createWorktree) {
      setError(t('git.apiMissing'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.vav.git.createWorktree(cwd, {
        path,
        newBranch: trimmedBranch
      })
      if (!result.ok) {
        showDialog({
          title: t('git.createWorktreeFailed'),
          body: result.error,
          confirmLabel: t('common.ok')
        })
        return
      }
      setForm(null)
      if (form.switchAfter && result.data.path) {
        await setWorkingDirectory(activeId, result.data.path)
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const openBranchMenu = async (el: HTMLElement): Promise<void> => {
    if (!snap?.isRepo || !cwd) return
    const items: MenuItem[] = [
      ...snap.branches.map((b) => ({
        label: b === snap.branch ? `✓ ${b}` : b,
        disabled: b === snap.branch,
        checked: b === snap.branch,
        onSelect: () => {
          void (async () => {
            setBusy(true)
            setError(null)
            try {
              const result = await window.vav.git.checkoutBranch(cwd, b)
              if (!result.ok) {
                showDialog({
                  title: t('git.checkoutFailed'),
                  body: result.error,
                  confirmLabel: t('common.ok')
                })
              }
              await refresh()
            } finally {
              setBusy(false)
            }
          })()
        }
      })),
      ...(snap.branches.length ? [{ label: '', divider: true } satisfies MenuItem] : []),
      {
        label: t('git.createBranch'),
        onSelect: openBranchForm
      }
    ]
    await showMenu(items, menuAnchor(el))
  }

  const openWorktreeMenu = async (el: HTMLElement): Promise<void> => {
    if (!snap?.isRepo || !cwd) return
    const items: MenuItem[] = [
      ...snap.worktrees.map((w) => ({
        label: w.isCurrent
          ? `✓ ${w.label}${w.branch ? ` · ${w.branch}` : ''}`
          : `${w.label}${w.branch ? ` · ${w.branch}` : ''}`,
        disabled: w.isCurrent,
        checked: w.isCurrent,
        onSelect: () => {
          void (async () => {
            setBusy(true)
            setError(null)
            try {
              await setWorkingDirectory(activeId, w.path)
              await refresh()
            } finally {
              setBusy(false)
            }
          })()
        }
      })),
      { label: '', divider: true },
      {
        label: t('git.createWorktree'),
        onSelect: openWorktreeForm
      }
    ]
    await showMenu(items, menuAnchor(el))
  }

  const forms = (
    <>
      {form?.kind === 'branch' && (
        <form
          className="session-workspace-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submitCreate()
          }}
        >
          <div className="session-workspace-form-title">{t('git.createBranch')}</div>
          <input
            ref={formInputRef}
            className="session-workspace-input"
            value={form.name}
            placeholder={t('git.branchNamePlaceholder')}
            disabled={busy}
            onChange={(e) => setForm({ kind: 'branch', name: e.target.value })}
          />
          <div className="session-workspace-form-actions">
            <Button
              label={t('common.cancel')}
              size="sm"
              disabled={busy}
              onClick={() => setForm(null)}
            />
            <Button
              label={busy ? t('common.loading') : t('git.createBranch')}
              variant="primary"
              size="sm"
              disabled={busy || !form.name.trim()}
              onClick={() => void submitCreate()}
            />
          </div>
        </form>
      )}

      {form?.kind === 'worktree' && snap?.isRepo && (
        <form
          className="session-workspace-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submitCreate()
          }}
        >
          <div className="session-workspace-form-title">{t('git.createWorktree')}</div>
          <input
            ref={formInputRef}
            className="session-workspace-input"
            value={form.branch}
            placeholder={t('git.newBranchPlaceholder')}
            disabled={busy}
            onChange={(e) => {
              const branch = e.target.value
              setForm({
                kind: 'worktree',
                branch,
                path: defaultWorktreePath(snap, cwd, branch),
                switchAfter: form.switchAfter
              })
            }}
          />
          <input
            className="session-workspace-input"
            value={form.path}
            placeholder={t('git.worktreePathPlaceholder')}
            disabled={busy}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
          />
          <label className="session-workspace-check">
            <input
              type="checkbox"
              checked={form.switchAfter}
              disabled={busy}
              onChange={(e) => setForm({ ...form, switchAfter: e.target.checked })}
            />
            {t('git.switchToWorktree')}
          </label>
          <div className="session-workspace-form-actions">
            <Button
              label={t('common.cancel')}
              size="sm"
              disabled={busy}
              onClick={() => setForm(null)}
            />
            <Button
              label={busy ? t('common.loading') : t('git.createWorktree')}
              variant="primary"
              size="sm"
              disabled={busy || !form.branch.trim()}
              onClick={() => void submitCreate()}
            />
          </div>
        </form>
      )}
    </>
  )

  if (initialLoad && !snap) {
    return (
      <div className="session-workspace-chrome" aria-busy="true">
        <p className="session-workspace-prose session-workspace-prose-muted">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  // No git yet (temp or plain folder) → one prose line + enable version control.
  if (!snap?.isRepo) {
    return (
      <div className="session-workspace-chrome">
        <p className="session-workspace-prose">
          <span className="session-workspace-prose-strong">{projectName}</span>{' '}
          <span className="session-workspace-prose-muted">
            {temporary ? t('git.prose.tempNotRepo') : t('git.prose.notRepo')}
          </span>{' '}
          <span className="session-workspace-prose-muted">{t('git.prose.enableLead')}</span>{' '}
          <TextBtn disabled={busy} onClick={() => void initRepo()}>
            {busy ? t('common.loading') : t('git.prose.enableAction')}
          </TextBtn>{' '}
          <span className="session-workspace-prose-muted">{t('git.prose.enableTail')}</span>
        </p>
        {error && <div className="session-workspace-error">{error}</div>}
      </div>
    )
  }

  const branchLabel = snap.detached
    ? t('git.detached', { head: snap.headShort ?? '?' })
    : snap.branch || t('git.unknownBranch')

  const worktreeLabel =
    snap.worktreeLabel === 'Local' ? t('git.local') : snap.worktreeLabel

  return (
    <div className="session-workspace-chrome">
      <p className="session-workspace-prose">
        {t('git.prose.onLead')}{' '}
        <TextBtn
          disabled={busy}
          title={cwd}
          onClick={(el) => void openWorktreeMenu(el)}
        >
          {worktreeLabel}
        </TextBtn>
        {t('git.prose.onMid')}{' '}
        <TextBtn disabled={busy} onClick={(el) => void openBranchMenu(el)}>
          {branchLabel}
        </TextBtn>
        {t('git.prose.onEnd')}
      </p>
      <p className="session-workspace-prose">
        {t('git.prose.createLead')}{' '}
        <TextBtn disabled={busy} onClick={() => openWorktreeForm()}>
          {t('git.prose.createWorktree')}
        </TextBtn>{' '}
        {t('git.prose.or')}{' '}
        <TextBtn disabled={busy} onClick={() => openBranchForm()}>
          {t('git.prose.createBranch')}
        </TextBtn>
        {t('git.prose.createEnd')}
      </p>

      {forms}

      {(error || snap.error) && (
        <div className="session-workspace-error">{error || snap.error}</div>
      )}
    </div>
  )
}
