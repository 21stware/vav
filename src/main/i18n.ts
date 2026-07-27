import { app } from 'electron'
import {
  resolveLocale,
  t as translate,
  type AppLocale,
  type MessageKey,
  type TParams
} from '@shared/i18n'
import type { LocalePreference } from '@shared/types'

let preference: LocalePreference = 'system'

export function setLocalePreference(next: LocalePreference): void {
  preference = next
}

export function currentLocale(): AppLocale {
  return resolveLocale(preference, app.getLocale())
}

export function t(key: MessageKey, params?: TParams): string {
  return translate(currentLocale(), key, params)
}
