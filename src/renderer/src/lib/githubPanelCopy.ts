import type { MessageKey, TParams } from '../../../shared/i18n/index.ts'
import type { GithubActionStatus, GithubErrorCode } from '../../../shared/github.ts'

export type GithubPanelTranslate = (key: MessageKey, params?: TParams) => string

export function emptyForCode(
  code: GithubErrorCode | undefined,
  fallback: string,
  t: GithubPanelTranslate
): { title: string; description: string } {
  if (code === 'not-github' || code === 'no-remote') {
    return { title: t('github.notGithub'), description: t('github.notGithubDesc') }
  }
  if (code === 'auth') {
    return { title: t('github.needAuth'), description: t('github.needAuthDesc') }
  }
  if (code === 'rate-limit') {
    return { title: t('github.rateLimit'), description: t('github.rateLimitDesc') }
  }
  if (code === 'not-found') {
    return { title: t('github.notFound'), description: t('github.notFoundDesc') }
  }
  if (code === 'network') {
    return { title: t('github.loadFailed'), description: t('github.networkDesc') }
  }
  return { title: t('github.loadFailed'), description: fallback }
}

export function actionStatusLabel(status: GithubActionStatus, t: GithubPanelTranslate): string {
  if (status === 'in_progress') return t('github.actionInProgress')
  if (status === 'queued') return t('github.actionQueued')
  if (status === 'waiting') return t('github.actionWaiting')
  if (status === 'pending' || status === 'requested') return t('github.actionPending')
  return t('github.actionCompleted')
}

export function pagesStatusLabel(status: string | null, t: GithubPanelTranslate): string {
  if (status === 'built') return t('github.siteStatusBuilt')
  if (status === 'building') return t('github.siteStatusBuilding')
  if (status === 'errored') return t('github.siteStatusErrored')
  return status || t('github.siteNone')
}
