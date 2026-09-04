import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type {
  GithubActionRun,
  GithubActionRunDetail,
  GithubPullDetail,
  GithubPullListItem,
  GithubRelease,
  GithubSite
} from '@shared/github'
import { fillGithubSiteGaps } from '@shared/github'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'
import { SafariIcon } from '../SafariIcon'
import { ActionDetail, PullDetail, ReleaseDetail, SitePane } from './GithubDetail'

/** Session-right preview: selected pull request conversation. */
export function GithubPullPreview({
  cwd,
  pull,
  onClose
}: {
  cwd: string
  pull: GithubPullListItem
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [detail, setDetail] = useState<GithubPullDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.vav?.github?.getPull) {
      setDetail(null)
      setError(t('github.apiMissing'))
      setLoading(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getPull(cwd, pull.number)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, pull.number, t])

  const live = detail && detail.number === pull.number ? detail : null
  const item = live ?? pull

  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={item.title}>
          #{item.number} {item.title}
        </span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openOnGithub')}
          onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <PullDetail
          item={item}
          detail={live}
          loading={loading}
          error={error}
          showOpen={false}
        />
      </div>
    </div>
  )
}

/** Session-right preview: selected running workflow. */
export function GithubActionPreview({
  cwd,
  run,
  onClose
}: {
  cwd: string
  run: GithubActionRun
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [detail, setDetail] = useState<GithubActionRunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.vav?.github?.getActionRun) {
      setDetail(null)
      setError(t('github.apiMissing'))
      setLoading(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getActionRun(cwd, run.id)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, run.id, t])

  const live = detail && detail.id === run.id ? detail : null
  const shown = live ?? run

  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={shown.title || shown.name}>
          {shown.title || shown.name}
        </span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openOnGithub')}
          onClick={() => window.open(shown.htmlUrl, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <ActionDetail
          run={shown}
          detail={live}
          loading={loading}
          error={error}
          showOpen={false}
        />
      </div>
    </div>
  )
}

/** Session-right preview: GitHub Pages configuration. */
export function GithubSitePreview({
  site,
  onClose
}: {
  site: GithubSite
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const liveUrl = fillGithubSiteGaps(site).url
  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title">{t('github.sitePages')}</span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={liveUrl ? t('github.openSite') : t('github.openPagesSettings')}
          onClick={() =>
            window.open(liveUrl || site.settingsUrl, '_blank', 'noopener,noreferrer')
          }
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <SitePane site={site} loading={false} error={null} code={undefined} showOpen={false} />
      </div>
    </div>
  )
}

/** Session-right preview: selected GitHub release. */
export function GithubReleasePreview({
  release,
  onClose
}: {
  release: GithubRelease
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={release.name || release.tag}>
          {release.name || release.tag}
        </span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openOnGithub')}
          onClick={() => window.open(release.htmlUrl, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <ReleaseDetail release={release} showOpen={false} />
      </div>
    </div>
  )
}
