import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { Button, EmptyState } from './ui'
import { GitDiffPreview, GitPatchPreview } from './GitChangesPanel'
import {
  GithubActionPreview,
  GithubPullPreview,
  GithubReleasePreview,
  GithubSitePreview
} from './githubPanel/GithubPreview'
import { CloudflareDeployPreview } from './CloudflarePanel'
import { SupabaseFunctionPreview } from './SupabasePanel'

const FileViewer = lazy(() => import('./FileViewer').then((m) => ({ default: m.FileViewer })))

class PreviewErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null }
  static getDerivedStateFromError(error: Error): { message: string } {
    return { message: error.message || 'preview failed' }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('file preview', error, info.componentStack)
  }
  render(): ReactNode {
    if (this.state.message) {
      return (
        <div className="workspace-preview-empty">
          <span data-testid="file-preview-name">{this.props.name}</span>
          <p className="muted">{this.state.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}

export function SessionPreviewPane({ path }: { path: string | null }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const sessionPreview = useSessionStore((s) => s.sessionPreview)
  const closeFilePreview = useSessionStore((s) => s.setFilePreviewOpen)
  const close = (): void => closeFilePreview(false)

  if (sessionPreview.kind === 'git') {
    return <GitDiffPreview cwd={sessionPreview.cwd} entry={sessionPreview.entry} onClose={close} />
  }
  if (sessionPreview.kind === 'git-patch') {
    return (
      <GitPatchPreview
        key={`patch-${sessionPreview.spec}`}
        cwd={sessionPreview.cwd}
        spec={sessionPreview.spec}
        title={sessionPreview.title}
        onClose={close}
      />
    )
  }
  if (sessionPreview.kind === 'github') {
    return <GithubPullPreview cwd={sessionPreview.cwd} pull={sessionPreview.pull} onClose={close} />
  }
  if (sessionPreview.kind === 'github-action') {
    return <GithubActionPreview cwd={sessionPreview.cwd} run={sessionPreview.run} onClose={close} />
  }
  if (sessionPreview.kind === 'github-site') {
    return <GithubSitePreview site={sessionPreview.site} onClose={close} />
  }
  if (sessionPreview.kind === 'github-release') {
    return <GithubReleasePreview release={sessionPreview.release} onClose={close} />
  }
  if (sessionPreview.kind === 'cloudflare') {
    return (
      <CloudflareDeployPreview
        status={sessionPreview.status}
        deploymentId={sessionPreview.deploymentId}
        onClose={close}
      />
    )
  }
  if (sessionPreview.kind === 'supabase') {
    return (
      <SupabaseFunctionPreview
        status={sessionPreview.status}
        functionSlug={sessionPreview.functionSlug}
        onClose={close}
      />
    )
  }
  if (path) {
    return (
      <PreviewErrorBoundary name={path.split(/[/\\]/).pop() || path}>
        <Suspense fallback={<div className="muted" style={{ padding: 24 }}>{t('common.loading')}</div>}>
          <FileViewer
            path={path}
            origin="session"
            parentConversationId={activeId}
            embedded
            onClose={close}
          />
        </Suspense>
      </PreviewErrorBoundary>
    )
  }
  return (
    <div className="workspace-preview-empty">
      <div className="workspace-preview-empty-bar">
        <span className="spacer" />
        <Button icon={<X size={14} />} title={t('common.close')} onClick={close} />
      </div>
      <EmptyState title={t('workspace.selectFile')} description={t('workspace.selectFileDesc')} />
    </div>
  )
}

export function usePreviewFilePath(workdir: string | null): string | null {
  const activeId = useSessionStore((s) => s.activeId)
  const selectedPath = useWorkspaceStore((s) =>
    activeId ? (s.workspaces[activeId]?.selectedPath ?? null) : null
  )
  const workspaceRoot = useWorkspaceStore((s) =>
    activeId ? (s.workspaces[activeId]?.root ?? null) : null
  )
  const workspaceDirs = useWorkspaceStore((s) =>
    activeId ? s.workspaces[activeId]?.dirs : undefined
  )
  if (!selectedPath) return null
  if (selectedPath === workspaceRoot || (workdir && selectedPath === workdir)) return null
  for (const entries of Object.values(workspaceDirs ?? {})) {
    const hit = entries.find((e) => e.path === selectedPath)
    if (hit) return hit.isDirectory ? null : selectedPath
  }
  return selectedPath
}
