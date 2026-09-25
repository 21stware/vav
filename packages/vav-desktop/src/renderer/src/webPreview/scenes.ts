import type { ChatMessage, Conversation, ConversationMeta } from '@shared/types'
import { VAV_DEFAULT_MODEL_ID } from '@shared/vavModelList'

export const WEB_PREVIEW_SCENES = ['chat', 'home', 'empty', 'settings'] as const
export type WebPreviewScene = (typeof WEB_PREVIEW_SCENES)[number]

export const WEB_PREVIEW_HOME = '/Users/preview'
export const WEB_PREVIEW_WORKSPACE = '/Users/preview/project'
export const WEB_PREVIEW_CHAT_ID = 'preview-chat'
export const WEB_PREVIEW_FILE_ID = 'preview-file'

export function parseWebPreviewScene(search = ''): WebPreviewScene {
  const query = search.startsWith('?') ? search.slice(1) : search
  const raw = new URLSearchParams(query).get('scene')
  if (raw === 'home' || raw === 'empty' || raw === 'settings') return raw
  return 'chat'
}

function meta(over: Partial<ConversationMeta> & Pick<ConversationMeta, 'id' | 'title'>): ConversationMeta {
  const now = over.updatedAt ?? over.createdAt ?? 1_700_000_000_000
  return {
    createdAt: now,
    updatedAt: now,
    workingDirectory: WEB_PREVIEW_WORKSPACE,
    machineId: 'local',
    model: VAV_DEFAULT_MODEL_ID,
    tokensUsed: 1_200,
    tokenLimit: 200_000,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    thinkingLevel: 'high',
    fileId: null,
    sessionKind: 'workspace',
    ...over
  }
}

function textMessage(
  id: string,
  parentId: string | null,
  role: ChatMessage['role'],
  text: string,
  createdAt: number
): ChatMessage {
  return {
    id,
    parentId,
    role,
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt
  }
}

export function previewConversation(now = 1_700_000_000_000): Conversation {
  const user = textMessage(
    'preview-user-1',
    null,
    'user',
    '把侧栏会话列表的密度再收一点，标题不要换行。',
    now - 60_000
  )
  const assistant = textMessage(
    'preview-asst-1',
    user.id,
    'assistant',
    '侧栏行高已经压到 28px，标题单行截断。Web preview 用的是夹具会话，不是 Electron preload。',
    now - 30_000
  )
  return {
    ...meta({
      id: WEB_PREVIEW_CHAT_ID,
      title: 'Sidebar density',
      tokensUsed: 1_200,
      createdAt: now - 120_000,
      updatedAt: now
    }),
    messages: [user, assistant],
    activeLeafId: assistant.id,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    quotaWindows: [],
    compactions: [],
    hostTranscripts: {},
    cliPaneBindings: {}
  }
}

export function previewFileConversation(now = 1_700_000_000_000): Conversation {
  const path = `${WEB_PREVIEW_WORKSPACE}/README.md`
  return {
    ...meta({
      id: WEB_PREVIEW_FILE_ID,
      title: 'README.md',
      sessionKind: 'file',
      fileId: 'preview-readme',
      focusedFilePath: path,
      tokensUsed: 0,
      createdAt: now - 90_000,
      updatedAt: now - 10_000
    }),
    messages: [],
    activeLeafId: null,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    quotaWindows: [],
    compactions: [],
    hostTranscripts: {},
    cliPaneBindings: {}
  }
}

export function conversationsForScene(scene: WebPreviewScene, now = 1_700_000_000_000): Conversation[] {
  if (scene === 'empty' || scene === 'settings') return []
  if (scene === 'home') return [previewFileConversation(now)]
  return [previewConversation(now), previewFileConversation(now)]
}

export function activeIdForScene(scene: WebPreviewScene): string {
  return scene === 'chat' ? WEB_PREVIEW_CHAT_ID : ''
}
