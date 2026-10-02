import { useEffect, useMemo } from 'react'
import { analysisSinceMs, filterAnalysisTurns } from '@shared/analysis'
import { isTimerDefinition } from '@shared/sessionKind'
import { conversationOnMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { refreshAnalysis, useAnalysisCache } from '../lib/analysisCache'
import { formatTokens } from '../lib/format'
import { APP_NAV } from '../lib/appNav'
import {
  weekTokensFromConversations,
  weekTurnTokens,
  workbenchLibraryCounts
} from '../lib/workbenchHomeStats'

/**
 * What the old Home page said, as one quiet line under the new-session hero:
 * this week's tokens and how much sits in Notes / Storage / Schedule. Each
 * fact jumps to its surface. Plan quota already lives in EmptyQuotaUsage.
 */
export function EmptyWorkbenchFacts(): React.JSX.Element | null {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const openSettings = useSessionStore((s) => s.openSettings)
  const setApplicationsMode = useSessionStore((s) => s.setApplicationsMode)
  const { snapshot } = useAnalysisCache()

  useEffect(() => {
    void refreshAnalysis({ force: false })
  }, [])

  const rows = useMemo(
    () => conversations.filter((row) => conversationOnMachine(row, windowMachineId)),
    [conversations, windowMachineId]
  )
  const counts = useMemo(() => workbenchLibraryCounts(rows), [rows])
  const schedules = useMemo(
    () => rows.filter((row) => !row.archived && isTimerDefinition(row)).length,
    [rows]
  )
  const now = snapshot?.now ?? Date.now()
  const weekTokens = useMemo(() => {
    if (snapshot?.usage == null) return weekTokensFromConversations(rows, now)
    return weekTurnTokens(filterAnalysisTurns(snapshot.usage.turns, analysisSinceMs('7d', now)))
  }, [now, rows, snapshot?.usage])

  const navLabel = (mode: string): string => {
    const item = APP_NAV.find((row) => row.mode === mode)
    return item ? t(item.labelKey) : mode
  }
  const facts: Array<{ id: string; text: string; onClick: () => void }> = []
  if (weekTokens > 0) {
    facts.push({
      id: 'week',
      text: `${t('workbench.home.statWeek')} ${formatTokens(weekTokens)} ${t('workbench.home.statWeekUnit')}`,
      onClick: () => openSettings('analysis')
    })
  }
  if (counts.notes > 0) {
    facts.push({
      id: 'notes',
      text: `${navLabel('knowledge')} ${counts.notes}`,
      onClick: () => setApplicationsMode('knowledge')
    })
  }
  if (counts.storage > 0) {
    facts.push({
      id: 'storage',
      text: `${navLabel('storage')} ${counts.storage}`,
      onClick: () => setApplicationsMode('storage')
    })
  }
  if (schedules > 0) {
    facts.push({
      id: 'scheduled',
      text: `${navLabel('scheduled')} ${schedules}`,
      onClick: () => setApplicationsMode('scheduled')
    })
  }
  if (facts.length === 0) return null

  return (
    <div className="empty-workbench-facts" data-testid="empty-workbench-facts">
      {facts.map((fact, index) => (
        <span key={fact.id} className="empty-workbench-fact-wrap">
          {index > 0 ? <span className="empty-workbench-fact-sep" aria-hidden>·</span> : null}
          <button
            type="button"
            className="linkish empty-workbench-fact"
            data-testid={`empty-fact-${fact.id}`}
            onClick={fact.onClick}
          >
            {fact.text}
          </button>
        </span>
      ))}
    </div>
  )
}
