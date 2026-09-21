import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'

export function usePreviewFilePath(workdir: string | null): string | null {
  const activeId = useSessionStore((s) => s.activeId)
  const selectedPath = useWorkspaceStore((s) =>
    activeId ? (s.workspaces[activeId]?.selectedPath ?? null) : null
  )
  const workspaceRoot = useWorkspaceStore((s) =>
    activeId ? (s.workspaces[activeId]?.root ?? null) : null
  )
  const workspaceDirs = useWorkspaceStore((s) =>
    activeId ? s.workspaces[activeId]?.dirs : undefined
  )
  if (!selectedPath) return null
  if (selectedPath === workspaceRoot || (workdir && selectedPath === workdir)) return null
  for (const entries of Object.values(workspaceDirs ?? {})) {
    const hit = entries.find((e) => e.path === selectedPath)
    if (hit) return hit.isDirectory ? null : selectedPath
  }
  return selectedPath
}
