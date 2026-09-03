import { readFileSync } from 'node:fs'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { FileInspectResult } from '@shared/ipc'
import type { FileSortKey } from '@shared/types'
import { isTsJsPath } from '@shared/previewBlock'
import { isClipPath, writeClip } from '../fs/clipStore'
import { writePngToClipboard } from '../clipboardImage'
import type { FileService } from '../fs/FileService'
import type { WorkingCopyService } from '../fs/WorkingCopyService'

export type FilesIpcShell = {
  machineIdFor: (event: IpcMainInvokeEvent, path: string) => string
  previewOn: (machineId: string, path: string) => Promise<void>
  openOn: (machineId: string, path: string) => Promise<unknown>
  takePreloadedInspect: (path: string) => Promise<FileInspectResult> | null
  showSaveDialog: (
    event: IpcMainInvokeEvent,
    options: Electron.SaveDialogOptions
  ) => Promise<Electron.SaveDialogReturnValue>
  showOpenDialog: (
    event: IpcMainInvokeEvent,
    options: Electron.OpenDialogOptions
  ) => Promise<Electron.OpenDialogReturnValue>
}

/** Workspace file list/read/write, clips, working copies, and open-with. */
export function registerFilesIpc(
  ipcMain: IpcMain,
  files: FileService,
  workingCopies: WorkingCopyService,
  shell: FilesIpcShell
): void {
  ipcMain.handle(IPC.filesPickAttachments, async (event) => {
    const result = await shell.showOpenDialog(event, {
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return { ok: false as const, cancelled: true }
    for (const p of result.filePaths) files.grantPath(p)
    return { ok: true as const, paths: result.filePaths }
  })
  ipcMain.handle(
    IPC.filesList,
    (_event, path: string, sort: FileSortKey, ascending: boolean, conversationId?: string) =>
      files.listDirectory(path, sort, ascending, conversationId)
  )
  ipcMain.handle(IPC.filesRead, (_event, path: string, conversationId?: string) =>
    files.readTextFile(path, conversationId)
  )
  ipcMain.handle(
    IPC.filesReadTextWindow,
    (
      _event,
      path: string,
      opts?: { startByte?: number; maxBytes?: number; force?: boolean; conversationId?: string }
    ) => files.readTextWindow(path, opts)
  )
  ipcMain.handle(IPC.filesReadBinary, (_event, path: string, conversationId?: string) =>
    files.readBinary(path, conversationId)
  )
  ipcMain.handle(
    IPC.filesReadBinaryWindow,
    (
      _event,
      path: string,
      opts?: { startByte?: number; maxBytes?: number; conversationId?: string }
    ) => files.readBinaryWindow(path, opts)
  )
  ipcMain.handle(
    IPC.filesWriteBinary,
    (_event, path: string, base64: string, conversationId?: string) =>
      files.writeBinary(path, base64, conversationId)
  )
  ipcMain.handle(
    IPC.filesWriteClip,
    (_event, input: { filename: string; base64?: string; text?: string }) => writeClip(input)
  )
  ipcMain.handle(IPC.filesCopyImage, (_event, path: string) => {
    try {
      if (typeof path !== 'string' || !isClipPath(path)) {
        return { ok: false as const, error: 'not a clip' }
      }
      return writePngToClipboard(readFileSync(path))
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
  ipcMain.handle(IPC.filesWrite, (_event, path: string, content: string, conversationId?: string) =>
    files.writeTextFile(path, content, conversationId)
  )
  ipcMain.handle(
    IPC.filesWorkingCopyEnsure,
    async (_event, path: string, opts?: { fileId?: string | null }) => {
      try {
        const st = await workingCopies.ensure(String(path || ''), {
          fileId: opts?.fileId
        })
        return { ok: true as const, ...st }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle(IPC.filesWorkingCopyPromote, async (_event, path: string) =>
    workingCopies.promote(String(path || ''))
  )
  ipcMain.handle(IPC.filesWorkingCopyDiscard, async (_event, path: string) => {
    const result = await workingCopies.discard(String(path || ''), { reseed: true })
    if (!result.ok) return result
    const st = workingCopies.status(String(path || ''))
    return { ok: true as const, dirty: st?.dirty ?? false }
  })
  ipcMain.handle(IPC.filesWorkingCopyStatus, (_event, path: string) =>
    workingCopies.status(String(path || ''))
  )
  ipcMain.handle(IPC.filesQuickLook, async (event, path: string) => {
    await shell.previewOn(shell.machineIdFor(event, String(path || '')), String(path || ''))
  })
  ipcMain.handle(IPC.filesOpenWithDefault, async (event, path: string) =>
    shell.openOn(shell.machineIdFor(event, String(path || '')), String(path || ''))
  )
  ipcMain.handle(IPC.filesWatch, (_event, id: string, root: string | null) =>
    files.watchRoot(id, root)
  )
  ipcMain.handle(
    IPC.filesInspectStructured,
    (
      _event,
      path: string,
      opts?: { maxBlocks?: number; maxRows?: number; conversationId?: string }
    ) => files.inspectStructured(String(path || ''), opts)
  )
  ipcMain.handle(
    IPC.filesSaveAs,
    async (
      event,
      defaultName: string,
      content: string
    ): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }> => {
      const result = await shell.showSaveDialog(event, {
        defaultPath: defaultName,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
      files.grantPath(result.filePath)
      const written = await files.writeTextFile(result.filePath, content)
      if (!written.ok) return { ok: false, error: written.error }
      return { ok: true, path: result.filePath }
    }
  )
  ipcMain.handle(IPC.filesRename, (_event, path: string, newName: string, conversationId?: string) =>
    files.rename(path, newName, conversationId)
  )
  ipcMain.handle(IPC.filesTrash, (_event, paths: string[], conversationId?: string) =>
    files.trash(paths, conversationId)
  )
  ipcMain.handle(
    IPC.filesInspect,
    (_event, path: string, conversationId?: string) =>
      (conversationId ? null : shell.takePreloadedInspect(path)) ??
      files.inspect(path, conversationId)
  )
  ipcMain.handle(
    IPC.filesDbQuery,
    (_event, path: string, table: string, offset?: number, limit?: number) =>
      files.dbQuery(path, table, offset, limit)
  )
  ipcMain.handle(IPC.filesParseBlocks, async (_event, path: string, text: string) => {
    if (!isTsJsPath(path)) return null
    try {
      const { parseTsCodeBlocks } = await import('../preview/parseTsCodeBlocks')
      return parseTsCodeBlocks(path, text)
    } catch {
      return null
    }
  })
}
