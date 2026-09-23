import type { LucideIcon } from 'lucide-react'
import {
  AppWindow,
  BookOpen,
  Bot,
  Clock,
  Database,
  Eye,
  FilePenLine,
  FileSearch,
  FileText,
  Folder,
  Globe,
  Library,
  StickyNote,
  KeyRound,
  ListTodo,
  Map,
  MessageCircleQuestion,
  MousePointer2,
  Pencil,
  Plug,
  ScrollText,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import type { ToolName } from '@shared/types'

/**
 * One Lucide mark per schema id. `Record<ToolName, …>` is exhaustive — a new
 * tool fails typecheck until it gets a glyph. Unknown / leaked CLI names
 * fall through to {@link iconForTool}'s wrench.
 */
export const TOOL_ICONS: Record<ToolName, LucideIcon> = {
  terminal: SquareTerminal,
  wait: Clock,
  read_bash_session: ScrollText,
  fs_read: FileText,
  fs_write: FilePenLine,
  fs_list: Folder,
  doc_search: FileSearch,
  doc_fetch: BookOpen,
  web_search: Search,
  web_fetch: Globe,
  request: MessageCircleQuestion,
  ask_user_question: MessageCircleQuestion,
  request_for_secret: KeyRound,
  plan: ListTodo,
  sql_query: Database,
  knowledge_search: FileSearch,
  knowledge_fetch: BookOpen,
  knowledge_write: FilePenLine,
  note_write: StickyNote,
  note_edit: FilePenLine,
  analysis_write: Database,
  analysis_edit: Database,
  schedule_write: Clock,
  schedule_edit: Clock,
  storage_write: Folder,
  storage_edit: Folder,
  knowledge_library: Library,
  app: AppWindow,
  load_skill: Sparkles,
  connector: Plug,
  switch_mode: Pencil,
  computer_list: AppWindow,
  computer_observe: Eye,
  computer_act: MousePointer2,
  task: Bot,
  plan_doc: Map,
  external: Wrench
}

export function iconForTool(tool: string): LucideIcon {
  return TOOL_ICONS[tool as ToolName] ?? Wrench
}
