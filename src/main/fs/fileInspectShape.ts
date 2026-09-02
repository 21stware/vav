import type { FileInspectResult } from '../../shared/ipc.ts'

export function deniedInspectResult(path: string, name: string, error: string): FileInspectResult {
  return { path, name, size: 0, kind: 'binary', mime: '', error }
}

export function directoryInspectResult(
  path: string,
  name: string,
  mtimeMs: number
): FileInspectResult {
  return {
    path,
    name,
    size: 0,
    mtimeMs,
    kind: 'directory',
    mime: 'inode/directory'
  }
}
