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

function systemLocale(): string {
  try {
    const electron = require('electron') as { app?: { getLocale: () => string } }
    const locale = electron.app?.getLocale()
    if (locale) return locale
  } catch {
    /* headless vavd — no Electron */
  }
  const lang = process.env.LANG || process.env.LC_ALL || ''
  return lang.replace(/[._].*$/, '') || 'en'
}

export function currentLocale(): AppLocale {
  return resolveLocale(preference, systemLocale())
}

export function t(key: MessageKey, params?: TParams): string {
  return translate(currentLocale(), key, params)
}
