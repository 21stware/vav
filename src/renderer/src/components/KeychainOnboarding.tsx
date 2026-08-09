import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Shield, Sparkles } from 'lucide-react'
import loadingSprite from '../assets/loading/sprite.png'
import loadingSpriteDark from '../assets/loading/dark-sprite.png'
import { useT } from '../i18n/useT'
import { BrandAppIcon } from './BrandAppIcon'
import { Button } from './ui'

type Step = 'welcome' | 'privacy' | 'authorize'

const STEPS: Step[] = ['welcome', 'privacy', 'authorize']

/**
 * Full-screen Keychain gate (macOS). First launch walks welcome → privacy →
 * authorize. Returning users who fail a silent unlock only see authorize.
 */
export function KeychainOnboarding({
  onUnlocked,
  authorizeOnly = false
}: {
  onUnlocked: () => void | Promise<void>
  /** Skip welcome/privacy — used after the tour has already been completed. */
  authorizeOnly?: boolean
}): React.JSX.Element {
  const t = useT()
  const [step, setStep] = useState<Step>(authorizeOnly ? 'authorize' : 'welcome')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const busyRef = useRef(false)

  const authorize = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await window.vav.secrets.unlock()
      if (!result.ok) {
        setError(result.error || t('keychain.error'))
        return
      }
      await onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('keychain.error'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [onUnlocked, t])

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (step !== 'authorize') setError(null)
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (busy) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (step === 'welcome') setStep('privacy')
        else if (step === 'privacy') setStep('authorize')
        else void authorize()
      } else if (e.key === 'Escape' && !authorizeOnly) {
        if (step === 'privacy') setStep('welcome')
        else if (step === 'authorize') setStep('privacy')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, busy, authorize, authorizeOnly])

  const visibleSteps = authorizeOnly ? (['authorize'] as Step[]) : STEPS
  const stepIndex = Math.max(0, visibleSteps.indexOf(step))
  const stepLabel =
    step === 'welcome'
      ? t('keychain.step.welcome')
      : step === 'privacy'
        ? t('keychain.step.privacy')
        : t('keychain.step.authorize')

  return (
    <div
      className="app-shell keychain-gate"
      data-step={step}
      data-entered={entered ? 'true' : 'false'}
      data-busy={busy ? 'true' : 'false'}
    >
      <div className="keychain-gate-wash" aria-hidden />
      <div className="keychain-gate-chrome" aria-hidden />

      <div className="keychain-gate-frame">
        <div className="keychain-gate-main">
          <div className="keychain-gate-brand">
            <BrandAppIcon size={108} appearance="any" className="keychain-gate-hero" />
            {busy && (
              <span className="keychain-gate-busy-mark" aria-hidden>
                <img
                  className="keychain-gate-busy-sprite logo-light"
                  src={loadingSprite}
                  alt=""
                  draggable={false}
                />
                <img
                  className="keychain-gate-busy-sprite logo-dark"
                  src={loadingSpriteDark}
                  alt=""
                  draggable={false}
                />
              </span>
            )}
          </div>

          <div className="keychain-gate-panel" key={step}>
            <p className="keychain-gate-stepmeta">
              <span className="keychain-gate-stepnum">
                {stepIndex + 1}
                <span className="keychain-gate-stepof"> / {visibleSteps.length}</span>
              </span>
              <span className="keychain-gate-steplabel">{stepLabel}</span>
            </p>

            {step === 'welcome' && (
              <>
                <h1 className="keychain-gate-title">{t('keychain.welcome.title')}</h1>
                <p className="keychain-gate-body">{t('keychain.welcome.body')}</p>
              </>
            )}

            {step === 'privacy' && (
              <>
                <h1 className="keychain-gate-title">{t('keychain.privacy.title')}</h1>
                <p className="keychain-gate-body">{t('keychain.privacy.body')}</p>
                <ul className="keychain-gate-features">
                  <li>
                    <span className="keychain-gate-feature-icon" aria-hidden>
                      <Lock size={16} strokeWidth={1.75} />
                    </span>
                    <div>
                      <div className="keychain-gate-feature-title">{t('keychain.privacy.f1title')}</div>
                      <div className="keychain-gate-feature-desc">{t('keychain.privacy.f1body')}</div>
                    </div>
                  </li>
                  <li>
                    <span className="keychain-gate-feature-icon" aria-hidden>
                      <Shield size={16} strokeWidth={1.75} />
                    </span>
                    <div>
                      <div className="keychain-gate-feature-title">{t('keychain.privacy.f2title')}</div>
                      <div className="keychain-gate-feature-desc">{t('keychain.privacy.f2body')}</div>
                    </div>
                  </li>
                  <li>
                    <span className="keychain-gate-feature-icon" aria-hidden>
                      <Sparkles size={16} strokeWidth={1.75} />
                    </span>
                    <div>
                      <div className="keychain-gate-feature-title">{t('keychain.privacy.f3title')}</div>
                      <div className="keychain-gate-feature-desc">{t('keychain.privacy.f3body')}</div>
                    </div>
                  </li>
                </ul>
              </>
            )}

            {step === 'authorize' && (
              <>
                <h1 className="keychain-gate-title">
                  {busy ? t('keychain.authorize.waitingTitle') : t('keychain.authorize.title')}
                </h1>
                <p className="keychain-gate-body">
                  {busy ? t('keychain.authorize.waitingBody') : t('keychain.authorize.body')}
                </p>
                {!busy && (
                  <p className="keychain-gate-aside">
                    {t('keychain.authorize.tip1')}
                    <br />
                    {t('keychain.authorize.tip2')}
                  </p>
                )}
                {error && (
                  <div className="keychain-gate-error" role="alert">
                    {error}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <footer className="keychain-gate-footer">
          {!authorizeOnly && (
            <div className="keychain-gate-progress" aria-hidden>
              {visibleSteps.map((s, i) => (
                <span
                  key={s}
                  className="keychain-gate-progress-seg"
                  data-active={stepIndex === i ? 'true' : 'false'}
                  data-done={stepIndex > i ? 'true' : 'false'}
                />
              ))}
            </div>
          )}

          <div className="keychain-gate-actions">
            {step === 'welcome' && (
              <Button
                label={t('keychain.welcome.continue')}
                variant="primary"
                className="keychain-gate-cta"
                onClick={() => setStep('privacy')}
              />
            )}
            {step === 'privacy' && (
              <>
                <Button
                  label={t('keychain.privacy.continue')}
                  variant="primary"
                  className="keychain-gate-cta"
                  onClick={() => setStep('authorize')}
                />
                <button
                  type="button"
                  className="keychain-gate-back"
                  onClick={() => setStep('welcome')}
                >
                  {t('keychain.back')}
                </button>
              </>
            )}
            {step === 'authorize' && (
              <>
                <Button
                  label={
                    busy
                      ? t('keychain.authorizing')
                      : error
                        ? t('keychain.authorize.retry')
                        : t('keychain.authorize')
                  }
                  variant="primary"
                  className="keychain-gate-cta"
                  disabled={busy}
                  onClick={() => void authorize()}
                />
                {!authorizeOnly && (
                  <button
                    type="button"
                    className="keychain-gate-back"
                    disabled={busy}
                    onClick={() => setStep('privacy')}
                  >
                    {t('keychain.back')}
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
