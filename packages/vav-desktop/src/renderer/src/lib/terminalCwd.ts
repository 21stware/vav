export function cwdFromSliceOrMeta(opts: {
  sliceRoot: string | null
  workingDirectory?: string | null
  machineId?: string | null
  defaultWorkingDirectory?: string | null
  hostHome?: string | null
  isLocalMachine: (id: string | undefined | null) => boolean
}): string | null {
  if (opts.sliceRoot && opts.sliceRoot !== '~') return opts.sliceRoot
  const fromMeta = opts.workingDirectory
  if (fromMeta && fromMeta !== '~') return fromMeta
  if (!opts.machineId || opts.isLocalMachine(opts.machineId)) {
    const fromSettings = opts.defaultWorkingDirectory?.trim()
    if (fromSettings) return fromSettings
    return null
  }
  return opts.hostHome?.trim() || null
}
