import { Type, type TSchema } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AppSettings, AskQuestion, PreviewRef, ToolName } from '@shared/types'
import type { FileService } from '../fs/FileService'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService'
import type { DuckDbService } from '../fs/DuckDbService'
import type { WebSearchService } from '../web/WebSearchService'
import type { WebFetchService } from '../web/WebFetchService'
import type { StickyShell } from '../terminal/StickyShell'
import type { SkillService } from './SkillService'

export interface ToolDetails {
  /** Full human-facing text for the tool card. */
  display: string
  /** Expected failure: the model should see an error, the card should say 失败. */
  failed?: boolean
}

export interface ToolHost {
  workdir: string
  settings: () => AppSettings
  files: FileService
  /** Routes fs/shell I/O to the conversation's workspace host. */
  conversationId: string
  shell: () => StickyShell
  /** Display-only: mirrors a terminal transcript into the Agent tab. */
  mirror: (text: string) => void
  fsChanged: (parentPath: string, filePath: string) => void
  /** Parks the turn until the renderer answers this card. */
  ask: (
    toolCallId: string,
    summary: string,
    options?: {
      choices?: string[]
      multiSelect?: boolean
      questions?: AskQuestion[]
      askTitle?: string
    }
  ) => Promise<{ text: string; cancelled: boolean }>
  /** Record an fs_write for Change Review (before/after already captured). */
  recordWrite?: (filePath: string, originalContent: string | null, newContent: string) => void
  retrieval?: DocumentRetrievalService
  duckdb?: DuckDbService
  webSearch?: WebSearchService
  webFetch?: WebFetchService
  skills?: SkillService
  braveSearchKey?: () => string | null
  tinyfishSearchKey?: () => string | null
  selectionAnchor?: () => PreviewRef[]
  defaultDocPath?: () => string | null
  isFileReadOnly?: () => boolean
  setFileReadOnly?: (readOnly: boolean) => string | null
}

export type { ToolName }

/** Keeps the parameter schema bound to `execute`, which `AgentTool[]` erases. */
export function defineTool<S extends TSchema>(tool: AgentTool<S, ToolDetails>): AgentTool<S, ToolDetails> {
  return tool
}

export function failure(message: string): {
  content: [{ type: 'text'; text: string }]
  details: ToolDetails
} {
  return {
    content: [{ type: 'text', text: message }],
    details: { display: message, failed: true }
  }
}

export async function park(
  answer: Promise<{ text: string; cancelled: boolean }>
): Promise<{ content: [{ type: 'text'; text: string }]; details: ToolDetails }> {
  const result = await answer
  if (result.cancelled) {
    return {
      content: [{ type: 'text', text: 'The user cancelled the turn without answering.' }],
      details: { display: '本轮已取消，问题未回答', failed: true }
    }
  }
  return {
    content: [{ type: 'text', text: result.text }],
    details: { display: result.text }
  }
}

export { Type }
