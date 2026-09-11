/**
 * Device-owner evaluation for revealing secrets.
 *
 * macOS uses Local Authentication (`systemPreferences.promptTouchID`) — the
 * same evaluatePolicy stack as Touch ID / password / passkeys. Other platforms
 * fall back to an explicit confirm. Values themselves live in Keychain-backed
 * `safeStorage` (SecretStore), not in this gate.
 */
export type OwnerAuthResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; error?: string }

export type OwnerAuthHost = {
  skip?: () => boolean
  canPromptTouchID?: () => boolean
  promptTouchID?: (reason: string) => Promise<void>
  fallbackConfirm?: (reason: string) => Promise<boolean>
}

export async function evaluateOwner(
  reason: string,
  host: OwnerAuthHost
): Promise<OwnerAuthResult> {
  if (host.skip?.()) return { ok: true }

  const prompt = reason.trim() || 'Verify to continue'
  let canBiometric = false
  try {
    canBiometric = Boolean(host.canPromptTouchID?.() && host.promptTouchID)
  } catch {
    canBiometric = false
  }

  if (canBiometric && host.promptTouchID) {
    try {
      await host.promptTouchID(prompt)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const cancelled = /cancel|denied|user.?cancel|(-2)\b|not interactive/i.test(message)
      return cancelled
        ? { ok: false, cancelled: true }
        : { ok: false, error: message }
    }
  }

  if (host.fallbackConfirm) {
    const ok = await host.fallbackConfirm(prompt)
    return ok ? { ok: true } : { ok: false, cancelled: true }
  }

  return { ok: false, error: 'Owner verification is unavailable' }
}
