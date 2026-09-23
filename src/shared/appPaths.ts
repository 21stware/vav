/**
 * Relocatable app-data and temp-dir paths.
 *
 * The pointer lives in the fixed Electron app-support folder so we can find
 * it before stores open. Empty configured values mean "use the product default":
 * `~/.vav` for conversations / app info, and the OS temp directory for
 * temporary workspaces.
 */
export type AppPathOverrides = {
  /** Absolute path. Empty / omitted = product default (`~/.vav` after auto-detect). */
  appDataDir?: string
  /** Absolute path. Empty / omitted = `os.tmpdir()`. */
  tempDir?: string
}

export type AppPathSnapshot = {
  /** Configured override (empty = default). */
  appDataDir: string
  defaultAppDataDir: string
  effectiveAppDataDir: string
  appDataBytes: number
  /** Configured override (empty = system temp). */
  tempDir: string
  defaultTempDir: string
  effectiveTempDir: string
  /** Bytes VAV is using under the effective temp root. */
  tempBytes: number
  tempIsCustom: boolean
  /** True when the next launch will read a different userData than this process. */
  restartRequired: boolean
}

export const APP_PATHS_POINTER_FILE = 'app-paths.json'
