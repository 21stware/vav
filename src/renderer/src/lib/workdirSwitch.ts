/**
 * Session working-directory switch (Tools path chip / ⌘⇧O).
 *
 * Swarm surface owns live CLI PTYs spawned with the session cwd — switching
 * the root would leave those processes on the old tree.
 */
export function isSwarmSurfaceActive(swarmEnabled: boolean, cliMode: boolean): boolean {
  return swarmEnabled === true && cliMode === true
}

export function swarmBlocksWorkdirSwitch(
  id: string | null | undefined,
  swarmEnabled: boolean,
  cliMode: boolean
): boolean {
  if (!id) return false
  return isSwarmSurfaceActive(swarmEnabled, cliMode)
}

export function allowWorkdirSwitch(opts: {
  swarmSurface: boolean
  /** File session still showing "Enclosed dir" (path bound until user switches). */
  enclosedUnrevealed: boolean
  /** Root gone — allow recover except on Swarm, where PTYs cannot follow. */
  rootMissing: boolean
}): boolean {
  if (opts.swarmSurface) return false
  return opts.rootMissing || !opts.enclosedUnrevealed
}

/** Folder name when locating a Temporary Workspace (no path separators). */
export function locateWorkspaceDefaultName(title: string | null | undefined): string {
  return (title || 'workspace').replace(/[\\/]/g, '-').slice(0, 64)
}
