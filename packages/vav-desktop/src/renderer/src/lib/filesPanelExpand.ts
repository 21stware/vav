export const EXPAND_ALL_MAX_DIRS = 80

/** Keep ancestors, drop this folder and every descendant from the expanded set. */
export function expandedAfterCollapseAll(expanded: string[], path: string): string[] {
  const prefix = path.endsWith('/') ? path : `${path}/`
  return expanded.filter((entry) => entry !== path && !entry.startsWith(prefix))
}
