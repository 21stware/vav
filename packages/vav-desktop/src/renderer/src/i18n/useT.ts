import { useCallback } from 'react'
import {
  t as translate,
  type AppLocale,
  type MessageKey,
  type TParams
} from '@shared/i18n'
import { useSessionStore } from '../state/sessionStore'

export function useLocale(): AppLocale {
  return useSessionStore((s) => s.resolvedLocale)
}

export function useT(): (key: MessageKey, params?: TParams) => string {
  const locale = useLocale()
  return useCallback((key: MessageKey, params?: TParams) => translate(locale, key, params), [locale])
}

/** Non-hook access for format helpers outside React. */
export function getResolvedLocale(): AppLocale {
  return useSessionStore.getState().resolvedLocale
}

export function tt(key: MessageKey, params?: TParams): string {
  return translate(getResolvedLocale(), key, params)
}
