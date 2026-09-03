import { BrowserWindow, dialog, type MessageBoxOptions, type WebContents } from 'electron'

/** Parent the box on the sender's window when that window is still alive. */
export async function showParentedMessageBox(
  parent: BrowserWindow | null | undefined,
  opts: MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  if (parent && !parent.isDestroyed()) return dialog.showMessageBox(parent, opts)
  return dialog.showMessageBox(opts)
}

export function windowFromSender(sender: WebContents | null | undefined): BrowserWindow | null {
  if (!sender) return null
  return BrowserWindow.fromWebContents(sender)
}
