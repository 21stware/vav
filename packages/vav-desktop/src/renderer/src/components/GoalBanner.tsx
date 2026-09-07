import type { JSX } from 'react'
import { Pause, Play, Target, X } from 'lucide-react'
import { goalBannerActions, type GoalAction, type GoalStatus } from '@shared/acpSession'
import { useSessionStore } from '../state/sessionStore'
import { Button } from './ui'
import { useT } from '../i18n/useT'

const STATUS_KEY: Record<GoalStatus, `goal.status.${GoalStatus}`> = {
  active: 'goal.status.active',
  paused: 'goal.status.paused',
  blocked: 'goal.status.blocked',
  limited: 'goal.status.limited',
  complete: 'goal.status.complete'
}

function bannerKind(status: GoalStatus): 'active' | 'paused' | 'warning' | 'success' {
  if (status === 'complete') return 'success'
  if (status === 'blocked' || status === 'limited') return 'warning'
  if (status === 'paused') return 'paused'
  return 'active'
}

function actionIcon(action: GoalAction) {
  if (action === 'pause') return <Pause size={12} strokeWidth={2} />
  if (action === 'resume') return <Play size={12} strokeWidth={2} />
  return <X size={12} strokeWidth={2} />
}

export function GoalBanner({
  conversationId
}: {
  conversationId?: string
} = {}): JSX.Element | null {
  const t = useT()
  const storeActiveId = useSessionStore((s) => s.activeId)
  const id = conversationId || storeActiveId
  const conversation = useSessionStore((s) => s.conversations.find((row) => row.id === id))
  const applyAcpGoal = useSessionStore((s) => s.applyAcpGoal)
  const goal = conversation?.acpSession?.goal
  const capability = conversation?.acpSession?.goalCapability
  const archived = conversation?.archived === true
  if (!id || !goal) return null

  const actions = goalBannerActions(goal, capability)
  const reason = goal.lastReason?.trim()

  return (
    <div className="goal-banner" data-kind={bannerKind(goal.status)} data-testid="goal-banner">
      <Target size={14} strokeWidth={2} className="goal-banner-icon" />
      <div className="goal-banner-copy">
        <div className="goal-banner-title">
          <span className="goal-banner-label">{t('goal.label')}</span>
          <span className="goal-banner-status">{t(STATUS_KEY[goal.status])}</span>
        </div>
        <div className="goal-banner-objective" title={goal.objective}>
          {goal.objective}
        </div>
        {reason ? <div className="goal-banner-reason">{reason}</div> : null}
      </div>
      {actions.length ? (
        <div className="goal-banner-actions">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'clear' ? 'ghost' : 'secondary'}
              icon={actionIcon(action)}
              label={t(action === 'pause' ? 'goal.pause' : action === 'resume' ? 'goal.resume' : 'goal.clear')}
              testId={`goal-${action}`}
              disabled={archived}
              onClick={() => void applyAcpGoal(id, action)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
