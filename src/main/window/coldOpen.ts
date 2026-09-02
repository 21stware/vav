export type ColdOpenFs = {
  existsSync: (path: string) => boolean
  realpathSync: (path: string) => string
  statSync: (path: string) => { isDirectory(): boolean }
}

/** A launch argument that will become a preview window rather than a session. */
export function isPreviewableColdOpenPath(path: string, fs: ColdOpenFs): boolean {
  if (!path) return false
  try {
    return fs.existsSync(path) && !fs.statSync(fs.realpathSync(path)).isDirectory()
  } catch {
    return false
  }
}
