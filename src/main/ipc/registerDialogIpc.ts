import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  dialogAlertOptions,
  dialogConfirmOptions,
  dialogMessageBoxOptions
} from './dialogOptions'
import { showParentedMessageBox, windowFromSender } from './nativeDialog'

export type DialogIpcLabels = {
  ok: string
  confirm: string
  cancel: string
}

/** Native alert / confirm / multi-button boxes used by the renderer. */
export function registerDialogIpc(ipcMain: IpcMain, labels: () => DialogIpcLabels): void {
  ipcMain.handle(
    IPC.dialogAlert,
    async (
      event,
      options: { title: string; message: string; confirmLabel?: string }
    ): Promise<void> => {
      await showParentedMessageBox(
        windowFromSender(event.sender),
        dialogAlertOptions(options, labels().ok)
      )
    }
  )

  ipcMain.handle(
    IPC.dialogConfirm,
    async (
      event,
      options: {
        title: string
        message: string
        confirmLabel?: string
        cancelLabel?: string
        destructive?: boolean
      }
    ): Promise<boolean> => {
      const copy = labels()
      const result = await showParentedMessageBox(
        windowFromSender(event.sender),
        dialogConfirmOptions(options, { confirm: copy.confirm, cancel: copy.cancel })
      )
      return result.response === 0
    }
  )

  ipcMain.handle(
    IPC.dialogMessageBox,
    async (
      event,
      options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title: string
        message: string
        detail?: string
        buttons: string[]
        defaultId?: number
        cancelId?: number
      }
    ): Promise<number> => {
      const result = await showParentedMessageBox(
        windowFromSender(event.sender),
        dialogMessageBoxOptions(options, labels().ok)
      )
      return result.response
    }
  )
}
