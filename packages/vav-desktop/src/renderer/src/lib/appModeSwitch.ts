import type { ApplicationsMode } from '../state/sessionTypes'

export type AppDetailByMode = Partial<Record<ApplicationsMode, boolean>>

/** Clicking the active tab returns to its list; switching tabs restores that tab. */
export function nextApplicationsModePatch(
  current: ApplicationsMode,
  next: ApplicationsMode,
  detailOpen: boolean,
  detailByMode: AppDetailByMode
): {
  applicationsMode: ApplicationsMode
  applicationsDetailOpen: boolean
  applicationsDetailByMode: AppDetailByMode
} {
  if (current === next) {
    return {
      applicationsMode: next,
      applicationsDetailOpen: false,
      applicationsDetailByMode: { ...detailByMode, [next]: false }
    }
  }
  const remembered = { ...detailByMode, [current]: detailOpen }
  return {
    applicationsMode: next,
    applicationsDetailOpen: remembered[next] === true,
    applicationsDetailByMode: remembered
  }
}
