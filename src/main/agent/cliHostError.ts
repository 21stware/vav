import type { QuotaWindow } from '../../shared/types.ts'
import type { AppLocale, MessageKey, TParams } from '../../shared/i18n/index.ts'
import {
  classifyCliError,
  isBareInternalError,
  pickExhaustedQuotaWindow,
  quotaKindMessageKey,
  type CliErrorKind
} from '../../shared/cliErrors.ts'
import { formatExpiry } from '../../shared/tokenUsage.ts'

type Translate = (key: MessageKey, params?: TParams) => string

export function describeCliHostError(
  raw: string,
  windows: QuotaWindow[],
  code: number | null | undefined,
  model: string | null | undefined,
  t: Translate,
  locale: AppLocale,
  now = Date.now()
): { kind: CliErrorKind; message: string } {
  const text = raw.trim() || 'Internal error'
  const kind = classifyCliError(text, windows, code, model)
  if (kind === 'cancelled') return { kind, message: text }
  if (kind === 'quota') {
    const window = pickExhaustedQuotaWindow(windows, model)
    if (window) {
      const name = t(quotaKindMessageKey(window.kind))
      const percent = window.usedPercent.toFixed(window.usedPercent >= 10 ? 0 : 1)
      if (window.resetsAt != null) {
        return {
          kind,
          message: t('error.quotaExceededReset', {
            window: name,
            percent,
            clock: formatExpiry(window.resetsAt, now, locale)
          })
        }
      }
      return { kind, message: t('error.quotaExceeded', { window: name, percent }) }
    }
    return { kind, message: t('error.quotaExceededGeneric') }
  }
  if (kind === 'session-stale') return { kind, message: t('error.sessionStale') }
  if (kind === 'auth') return { kind, message: t('error.agentAuthRequired') }
  if (kind === 'network') return { kind, message: t('error.network') }
  if (isBareInternalError(text)) return { kind: 'generic', message: t('error.agentInternal') }
  return { kind, message: text }
}
