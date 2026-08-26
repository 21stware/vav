/**
 * Whether a structured CLI runtime / resume cursor must be dropped.
 *
 * Drivers bind cwd at spawn. The next turn starts a fresh session in the
 * new tree; {@link CliAgentHost} hands the stored transcript across so the
 * conversation continues.
 */
export function shouldReplaceCliRuntime(
  runtimeCwd: string | undefined,
  wantedCwd: string,
  starting: boolean
): boolean {
  return runtimeCwd !== wantedCwd || starting
}
