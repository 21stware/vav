import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Shield, Sparkles, type LucideIcon } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { AppSettings } from '@shared/types'
import loadingSprite from '../../assets/loading/sprite.png'
import loadingSpriteDark from '../../assets/loading/dark-sprite.png'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { BrandAppIcon } from '../BrandAppIcon'
import { Button } from '../ui'
import { AgentStep, type OnboardingAgentChoice } from './AgentStep'
import { WelcomeIllustration } from './WelcomeIllustration'
import { WorkspaceStep, type OnboardingWorkspace } from './WorkspaceStep'
import {
  onboardingSteps,
  phaseSteps,
  type OnboardingPhase,
  type OnboardingStep
} from './onboardingSteps'

const STEP_LABEL: Record<OnboardingStep, MessageKey> = {
  welcome: 'onboarding.step.welcome',
  security: 'onboarding.step.security',
  agent: 'onboarding.step.agent',
  workspace: 'onboarding.step.workspace'
}

const SECURITY_POINTS: { Icon: LucideIcon; key: MessageKey }[] = [
  { Icon: Lock, key: 'onboarding.security.p1' },
  { Icon: Shield, key: 'onboarding.security.p2' },
  { Icon: Sparkles, key: 'onboarding.security.p3' }
]

/** Enter already means something here: typing, or a button's own click (Install, Sign in, the CTA). */
function ownsEnter(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName)
  )
}

/**
 * Full-window first-launch flow. See {@link OnboardingPhase} for where each
 * phase mounts; `gate` hands off to `setup` once the store has bootstrapped.
 */
export function Onboarding({
  phase,
  authorizeOnly = false,
  onUnlocked,
  onDone
}: {
  phase: OnboardingPhase
  /** Gate only: returning user whose silent unlock failed — just the Keychain step. */
  authorizeOnly?: boolean
  /** Gate only: Keychain is open; resolve after bootstrap so the gate stays up meanwhile. */
  onUnlocked?: () => Promise<void>
  /** Preview only: close the replay. Setup finishes by flipping `onboardingCompleted`. */
  onDone?: () => void
}): React.JSX.Element {
  const t = useT()
  const platform = window.vav.platform
  const allSteps = onboardingSteps(platform)
  const steps = phaseSteps(phase, platform, authorizeOnly)
  const preview = phase === 'preview'
  const [step, setStep] = useState<OnboardingStep>(steps[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const [agent, setAgent] = useState<OnboardingAgentChoice | null>(null)
  const [workspace, setWorkspace] = useState<OnboardingWorkspace>({ kind: 'temp' })
  const busyRef = useRef(false)

  const index = steps.indexOf(step)
  const isLast = index === steps.length - 1
  const canBack = index > 0 && !busy
  // Setup and preview can be left at any point; the Keychain gate cannot.
  const canSkip = phase !== 'gate' && (step === 'agent' || step === 'workspace')

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    setError(null)
  }, [step])

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await work()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const finish = useCallback(
    (apply: boolean) =>
      run(async () => {
        if (preview) {
          onDone?.()
          return
        }
        const store = useSessionStore.getState()
        if (apply) {
          const patch: Partial<AppSettings> = {}
          if (agent) patch.defaultAgentId = agent.defaultAgentId
          if (Object.keys(patch).length) await store.updateSettings(patch)
          // Mint the first session before the shell mounts so it opens on it.
          await store.createConversation({
            workingDirectory: workspace.kind === 'folder' ? workspace.path : null,
            openIn: 'here'
          })
        }
        await store.updateSettings({ onboardingCompleted: true })
        requestAnimationFrame(() => requestAnimationFrame(() => useSessionStore.getState().focusComposer()))
      }),
    [run, preview, onDone, agent, workspace]
  )

  const authorize = useCallback(
    () =>
      run(async () => {
        setError(null)
        if (preview) {
          setStep(steps[index + 1])
          return
        }
        try {
          const result = await window.vav.secrets.unlock()
          if (!result.ok) {
            setError(result.error || t('onboarding.security.error'))
            return
          }
          await onUnlocked?.()
        } catch (err) {
          setError(err instanceof Error ? err.message : t('onboarding.security.error'))
        }
      }),
    [run, preview, steps, index, onUnlocked, t]
  )

  const next = useCallback((): void => {
    if (step === 'security') void authorize()
    else if (isLast) void finish(true)
    else setStep(steps[index + 1])
  }, [step, isLast, steps, index, authorize, finish])

  const back = useCallback((): void => {
    if (canBack) setStep(steps[index - 1])
  }, [canBack, steps, index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (busyRef.current) return
      if (e.key === 'Enter' && !ownsEnter(e.target)) {
        e.preventDefault()
        next()
      } else if (e.key === 'Escape') {
        if (canBack) back()
        else if (preview) onDone?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, canBack, preview, onDone])

  const ctaLabel =
    step === 'welcome'
      ? t('onboarding.welcome.cta')
      : step === 'security'
        ? busy
          ? t('onboarding.security.waiting')
          : error
            ? t('onboarding.security.retry')
            : t('onboarding.security.cta')
        : isLast
          ? t('onboarding.finish')
          : t('onboarding.continue')

  const showHero = step === 'welcome' || step === 'security'

  return (
    <div
      className={`app-shell onboarding${preview ? ' is-preview' : ''}`}
      data-step={step}
      data-entered={entered ? 'true' : 'false'}
      data-busy={busy ? 'true' : 'false'}
      data-testid="onboarding"
    >
      <div className="onboarding-wash" aria-hidden />
      <div className="onboarding-chrome" aria-hidden />

      <div className="onboarding-frame">
        <div className="onboarding-main">
          {showHero ? (
            <div className="onboarding-brand">
              <BrandAppIcon size={step === 'welcome' ? 88 : 76} appearance="any" className="onboarding-hero" />
              {busy && step === 'security' ? (
                <span className="onboarding-busy-mark" aria-hidden>
                  <span className="onboarding-busy-clip">
                    <img className="onboarding-busy-sprite logo-light" src={loadingSprite} alt="" draggable={false} />
                    <img className="onboarding-busy-sprite logo-dark" src={loadingSpriteDark} alt="" draggable={false} />
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="onboarding-panel" key={step}>
            {authorizeOnly ? null : (
              <p className="onboarding-stepmeta">
                <span className="onboarding-stepnum">
                  {allSteps.indexOf(step) + 1}
                  <span className="onboarding-stepof"> / {allSteps.length}</span>
                </span>
                <span className="onboarding-steplabel">{t(STEP_LABEL[step])}</span>
              </p>
            )}

            {step === 'welcome' ? (
              <>
                <h1 className="onboarding-title">{t('onboarding.welcome.title')}</h1>
                <p className="onboarding-body">{t('onboarding.welcome.body')}</p>
                <WelcomeIllustration />
              </>
            ) : null}

            {step === 'security' ? (
              <>
                <h1 className="onboarding-title">
                  {busy ? t('onboarding.security.waiting') : t('onboarding.security.title')}
                </h1>
                <p className="onboarding-body">
                  {busy ? t('onboarding.security.waitingBody') : t('onboarding.security.body')}
                </p>
                <ul className="onboarding-points">
                  {SECURITY_POINTS.map(({ Icon, key }) => (
                    <li key={key}>
                      <Icon size={14} strokeWidth={1.9} aria-hidden />
                      <span>{t(key)}</span>
                    </li>
                  ))}
                </ul>
                {!busy ? <p className="onboarding-aside">{t('onboarding.security.tip')}</p> : null}
                {error ? (
                  <div className="onboarding-error" role="alert">
                    {error}
                  </div>
                ) : null}
              </>
            ) : null}

            {step === 'agent' ? (
              <>
                <h1 className="onboarding-title">{t('onboarding.agent.title')}</h1>
                <p className="onboarding-body">{t('onboarding.agent.body')}</p>
                <AgentStep preview={preview} value={agent} onChange={setAgent} />
              </>
            ) : null}

            {step === 'workspace' ? (
              <>
                <h1 className="onboarding-title">{t('onboarding.workspace.title')}</h1>
                <p className="onboarding-body">{t('onboarding.workspace.body')}</p>
                <WorkspaceStep value={workspace} onChange={setWorkspace} />
              </>
            ) : null}
          </div>
        </div>

        <footer className="onboarding-footer">
          {authorizeOnly ? null : (
            <div className="onboarding-progress" aria-label={t('onboarding.steps')}>
              {allSteps.map((s, i) => (
                <span
                  key={s}
                  className="onboarding-progress-seg"
                  data-active={s === step ? 'true' : 'false'}
                  data-done={i < allSteps.indexOf(step) ? 'true' : 'false'}
                />
              ))}
            </div>
          )}

          <div className="onboarding-actions">
            <Button
              label={ctaLabel}
              variant="primary"
              className="onboarding-cta"
              testId="onboarding-next"
              disabled={busy}
              onClick={next}
            />
            {canBack || canSkip ? (
              <div className="onboarding-secondary">
                {canBack ? (
                  <button type="button" className="onboarding-back" onClick={back}>
                    {t('onboarding.back')}
                  </button>
                ) : null}
                {canSkip ? (
                  <button
                    type="button"
                    className="onboarding-back"
                    data-testid="onboarding-skip"
                    disabled={busy}
                    onClick={() => void finish(false)}
                  >
                    {t('onboarding.skip')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  )
}
