import type { MessageKey, TParams } from '@shared/i18n/index.ts'
import type {
  GithubActionStatus,
  GithubErrorCode,
  GithubReviewState
} from '@shared/github.ts'
import { githubActionOutcome } from './githubPanelState.ts'

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

export function actionStatusLabel(
  status: GithubActionStatus,
  t: GithubPanelTranslate,
  conclusion?: string | null
): string {
  switch (githubActionOutcome(status, conclusion)) {
    case 'in_progress':
      return t('github.actionInProgress')
    case 'queued':
      return t('github.actionQueued')
    case 'waiting':
      return t('github.actionWaiting')
    case 'pending':
      return t('github.actionPending')
    case 'failure':
      return t('github.actionFailed')
    case 'cancelled':
      return t('github.actionCancelled')
    case 'skipped':
      return t('github.actionSkipped')
    case 'timed_out':
      return t('github.actionTimedOut')
    case 'action_required':
      return t('github.actionRequired')
    default:
      return t('github.actionCompleted')
  }
}

export function pagesStatusLabel(status: string | null, t: GithubPanelTranslate): string {
  if (status === 'built') return t('github.siteStatusBuilt')
  if (status === 'building') return t('github.siteStatusBuilding')
  if (status === 'errored') return t('github.siteStatusErrored')
  return status || t('github.siteNone')
}

export function reviewStateLabel(state: GithubReviewState, t: GithubPanelTranslate): string {
  if (state === 'approved') return t('github.approved')
  if (state === 'changes_requested') return t('github.changesRequested')
  if (state === 'dismissed') return t('github.dismissed')
  return t('github.commented')
}
