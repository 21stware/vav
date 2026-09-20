import { useSessionStore } from '../state/sessionStore'
import { SessionDetail } from './SessionDetail'

/** Agent column. File / git / object previews live in the app column. */
export function WorkspaceView({
  conversationId
}: {
  workdir: string | null
  conversationId: string
}): React.JSX.Element {
  void conversationId
  return <SessionDetail />
}

/** @deprecated use setFilePreviewOpen — kept for any external callers. */
export function useSessionFilePreview(): {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
} {
  const open = useSessionStore((s) => s.filePreviewOpen)
  const setOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const toggle = useSessionStore((s) => s.toggleFilePreview)
  return { open, setOpen, toggle }
}
