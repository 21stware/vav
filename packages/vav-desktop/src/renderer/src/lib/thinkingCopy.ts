import { thinkingDurationParts } from '@shared/thinkingLevel'
import type { MessageKey, TParams } from '@shared/i18n/index.ts'

type Translate = (key: MessageKey, params?: TParams) => string

function joinDuration(parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

/** "5 seconds", "1 minute 5 seconds", "1 hour 2 minutes". */
export function formatThinkingDuration(durationMs: number, t: Translate): string {
  const { hours, minutes, seconds } = thinkingDurationParts(durationMs)
  const parts: string[] = []
  if (hours > 0) {
    parts.push(hours === 1 ? t('composer.durationHour') : t('composer.durationHours', { n: hours }))
  }
  if (minutes > 0) {
    parts.push(
      minutes === 1 ? t('composer.durationMinute') : t('composer.durationMinutes', { n: minutes })
    )
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(
      seconds === 1 ? t('composer.durationSecond') : t('composer.durationSeconds', { n: seconds })
    )
  }
  return joinDuration(parts)
}

export function thinkingLabel(
  durationMs: number | undefined,
  live: boolean,
  t: Translate
): string {
  if (durationMs == null) return live ? t('composer.thinking') : t('composer.thinkingProcess')
  const duration = formatThinkingDuration(durationMs, t)
  return live ? t('composer.thinkingForLive', { duration }) : t('composer.thinkingFor', { duration })
}
