import { useSyncExternalStore } from 'react'
import type { AnalysisSnapshot } from '@shared/analysis'

export interface AnalysisCacheState {
  snapshot: AnalysisSnapshot | null
  error: string | null
  /** First load — no snapshot yet. */
  syncing: boolean
  /** Manual refresh button. */
  refreshing: boolean
  /** In-flight fetch while a snapshot is already on screen. */
  updating: boolean
}

const listeners = new Set<() => void>()
let state: AnalysisCacheState = {
  snapshot: null,
  error: null,
  syncing: false,
  refreshing: false,
  updating: false
}
let background: Promise<void> | null = null
let forceRun: Promise<void> | null = null

function emit(patch: Partial<AnalysisCacheState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAnalysisCache(): AnalysisCacheState {
  return state
}

export function useAnalysisCache(): AnalysisCacheState {
  return useSyncExternalStore(subscribe, getAnalysisCache)
}

export function applyAnalysisSnapshot(snapshot: AnalysisSnapshot): void {
  emit({ snapshot, error: null })
}

export function refreshAnalysis(options?: { force?: boolean }): Promise<void> {
  if (typeof window.vav.settings?.analysis !== 'function') {
    console.error('[analysis] settings.analysis is unavailable')
  }
  if (options?.force) {
    if (forceRun) return forceRun
    forceRun = (async () => {
      emit({ refreshing: true, updating: Boolean(state.snapshot), error: null })
      try {
        const next = await window.vav.settings.analysis({ refresh: true })
        emit({ snapshot: next, error: null })
      } catch (err) {
        emit({
          error: err instanceof Error ? err.message : String(err)
        })
      } finally {
        emit({ refreshing: false, updating: false })
        forceRun = null
      }
    })()
    return forceRun
  }
  if (background || forceRun) return forceRun ?? background!
  background = (async () => {
    emit({ syncing: !state.snapshot, updating: Boolean(state.snapshot), error: null })
    try {
      const next = await window.vav.settings.analysis({ refresh: false })
      emit({ snapshot: next, error: null, syncing: false, updating: false })
    } catch (err) {
      if (!state.snapshot) {
        emit({
          error: err instanceof Error ? err.message : String(err)
        })
      }
    } finally {
      emit({ syncing: false, updating: false })
      background = null
    }
  })()
  return background
}

export function installAnalysisBridge(): () => void {
  const onUpdated = window.vav.onSettingsAnalysis
  const off = onUpdated ? onUpdated(applyAnalysisSnapshot) : () => undefined
  void refreshAnalysis({ force: false })
  return off
}
