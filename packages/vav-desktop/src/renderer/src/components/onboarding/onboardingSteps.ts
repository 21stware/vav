/**
 * First-launch flow, ending at "ready to send the first message".
 *
 * macOS splits it around bootstrap: welcome + security run before the store
 * loads (Keychain must unlock first), agent + workspace run after. Other
 * platforms have no Keychain gate and run the whole flow after bootstrap.
 */

export type OnboardingStep = 'welcome' | 'security' | 'agent' | 'workspace'

/**
 * `gate` — pre-bootstrap Keychain tour (macOS).
 * `setup` — post-bootstrap, until `settings.onboardingCompleted`.
 * `preview` — dev replay from Settings → About; every step, no side effects.
 */
export type OnboardingPhase = 'gate' | 'setup' | 'preview'

export function onboardingSteps(platform: string): OnboardingStep[] {
  return platform === 'darwin'
    ? ['welcome', 'security', 'agent', 'workspace']
    : ['welcome', 'agent', 'workspace']
}

/** Steps this phase may visit, in order. Numbering still uses the full list. */
export function phaseSteps(
  phase: OnboardingPhase,
  platform: string,
  authorizeOnly = false
): OnboardingStep[] {
  const all = onboardingSteps(platform)
  if (phase === 'preview') return all
  if (phase === 'gate') return authorizeOnly ? ['security'] : ['welcome', 'security']
  // Setup on macOS picks up after the Keychain step the gate already ran.
  return all.filter((step) => step !== 'security' && (platform !== 'darwin' || step !== 'welcome'))
}

export type OnboardingInstallState = 'ready' | 'missing' | 'unknown'

export type OnboardingCliAgent = { id: string; name: string; installCommand?: string | null }

export type OnboardingAgentRow =
  | { kind: 'cli'; id: string; name: string; install: OnboardingInstallState; installCommand: string }
  | { kind: 'vav'; id: 'vav'; name: string }

/** Offered with an Install button when not on PATH; the rest live in Settings. */
const FEATURED_CLI = ['claude', 'codex', 'droid']

/**
 * Installed CLI agents first (catalogue order), then the built-in agent, then
 * the featured CLIs that are still missing. Unknown (still probing) counts as
 * missing for featured rows so the list does not jump when the probe lands.
 */
export function onboardingAgentRows(
  catalogue: readonly OnboardingCliAgent[],
  install: Record<string, OnboardingInstallState | undefined>,
  vavName: string
): OnboardingAgentRow[] {
  const cli = (agent: OnboardingCliAgent): OnboardingAgentRow => ({
    kind: 'cli',
    id: agent.id,
    name: agent.name,
    install: install[agent.id] ?? 'unknown',
    installCommand: agent.installCommand?.trim() ?? ''
  })
  const installed = catalogue.filter((agent) => install[agent.id] === 'ready').map(cli)
  const featured = FEATURED_CLI.map((id) => catalogue.find((agent) => agent.id === id))
    .filter((agent): agent is OnboardingCliAgent => !!agent && install[agent.id] !== 'ready')
    .map(cli)
  return [...installed, { kind: 'vav', id: 'vav', name: vavName }, ...featured]
}

/** Pre-select an installed, signed-in CLI; else any installed CLI; else the built-in agent. */
export function defaultOnboardingAgent(
  rows: readonly OnboardingAgentRow[],
  signedIn: ReadonlySet<string>
): string {
  const installed = rows.filter((row) => row.kind === 'cli' && row.install === 'ready')
  return (installed.find((row) => signedIn.has(row.id)) ?? installed[0])?.id ?? 'vav'
}
