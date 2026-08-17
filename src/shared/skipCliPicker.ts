/**
 * When to auto-launch the sole enabled CLI agent instead of showing the picker.
 *
 * Skip-picker is for a **new** Swarm / split only. Closing the last live pane
 * always reseeds the picker so ⌘W can then close the window.
 */
export type SkipCliPickerReason = 'enter' | 'split' | 'reseed'

export function shouldAutoAssignSingleCliAgent(options: {
  skipWhenSingle: boolean
  enabledCount: number
  reason: SkipCliPickerReason
}): boolean {
  if (options.reason === 'reseed') return false
  return options.skipWhenSingle === true && options.enabledCount === 1
}
