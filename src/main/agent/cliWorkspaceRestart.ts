/**
 * Whether a structured CLI runtime / resume cursor must be dropped.
 *
 * Drivers bind cwd at spawn. Resuming the old session after a workspace
 * switch would keep tools on the previous tree.
 */
export function shouldReplaceCliRuntime(
  runtimeCwd: string | undefined,
  wantedCwd: string,
  starting: boolean
): boolean {
  return runtimeCwd !== wantedCwd || starting
}
