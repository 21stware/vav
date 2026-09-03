export type DialogBoxOptions = {
  type: 'none' | 'info' | 'error' | 'question' | 'warning'
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId: number
  cancelId?: number
}

export function dialogAlertOptions(
  options: { title: string; message: string; confirmLabel?: string },
  okLabel: string
): DialogBoxOptions {
  return {
    type: 'info',
    title: options.title,
    message: options.title,
    detail: options.message,
    buttons: [options.confirmLabel ?? okLabel],
    defaultId: 0
  }
}

export function dialogConfirmOptions(
  options: {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
    /** Enter chooses Cancel — LAN pair, delete, and other easy-to-regret prompts. */
    preferCancel?: boolean
  },
  labels: { confirm: string; cancel: string }
): DialogBoxOptions {
  const confirmLabel = options.confirmLabel ?? labels.confirm
  const cancelLabel = options.cancelLabel ?? labels.cancel
  const cancelDefault = Boolean(options.destructive || options.preferCancel)
  return {
    type: options.destructive ? 'warning' : 'question',
    title: options.title,
    message: options.title,
    detail: options.message,
    buttons: [confirmLabel, cancelLabel],
    defaultId: cancelDefault ? 1 : 0,
    cancelId: 1
  }
}

export function dialogMessageBoxOptions(
  options: {
    type?: DialogBoxOptions['type']
    title: string
    message: string
    detail?: string
    buttons: string[]
    defaultId?: number
    cancelId?: number
  },
  okLabel: string
): DialogBoxOptions {
  const buttons = options.buttons?.length > 0 ? options.buttons : [okLabel]
  return {
    type: options.type ?? 'question',
    title: options.title,
    message: options.message || options.title,
    detail: options.detail,
    buttons,
    defaultId: options.defaultId ?? 0,
    cancelId: options.cancelId ?? buttons.length - 1
  }
}

export function revealSecretBoxOptions(copy: {
  cancel: string
  confirm: string
  title: string
  detail: string
}): DialogBoxOptions {
  return {
    type: 'warning',
    title: copy.title,
    message: copy.title,
    detail: copy.detail,
    buttons: [copy.cancel, copy.confirm],
    defaultId: 0,
    cancelId: 0
  }
}
