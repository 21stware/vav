import {
  scanWorkspaceRunScripts,
  type NodePackageManager,
  type WorkspaceRunScript
} from '@shared/workspaceRunScripts.ts'

export type { NodePackageManager, WorkspaceRunScript }

export async function loadWorkspaceRunScripts(
  root: string | null | undefined,
  conversationId?: string
): Promise<{ scripts: WorkspaceRunScript[]; packageManager: NodePackageManager | null }> {
  const dir = root?.trim()
  if (!dir || !window.vav?.files?.list) {
    return { scripts: [], packageManager: null }
  }
  return scanWorkspaceRunScripts(dir, {
    list: async (path) => {
      const listing = await window.vav.files.list(path, 'name', true, conversationId)
      return listing.error ? [] : listing.entries
    },
    readText: async (path) => {
      const result = await window.vav.files.read(path, conversationId)
      return result.error ? null : result.content
    }
  })
}
