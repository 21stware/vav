/**
 * Native capture composites listed windows' backing stores. Omitting this
 * process's pid is enough to keep VAV out of the shot — hide timing and
 * opacity tricks do not change the composite.
 */
export function nativeCaptureExcludePid(hideWindows: boolean, pid: number): number {
  return hideWindows && pid > 0 ? pid : 0
}
