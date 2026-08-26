import { join } from 'node:path'

export const E2E_SESSION_ID = 'e2e-session'
export const E2E_SESSION_B_ID = 'e2e-session-b'

export type SeedConversationKind = 'empty' | 'agent' | 'acp' | 'acp-live' | 'rich'

const USER_1 = 'e2e-user-1'
const ASST_1 = 'e2e-asst-1'
const USER_2 = 'e2e-user-2'
const ASST_2 = 'e2e-asst-2'
const USER_3 = 'e2e-user-3'
const ASST_3 = 'e2e-asst-3'

function baseConversation(now: number, workspace: string) {
  return {
    id: E2E_SESSION_ID,
    title: 'E2E session',
    createdAt: now,
    updatedAt: now,
    workingDirectory: workspace,
    model: 'deepseek-v4-flash-vision-exp',
    tokensUsed: 0,
    tokenLimit: 200_000,
    messages: [] as unknown[],
    activeLeafId: null as string | null,
    tokenHistory: [],
    reportedSessionCostUsd: null,
    quotaWindows: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    thinkingLevel: 'high',
    fileId: null,
    fileReadOnly: false,
    agentBinaryName: null as string | null,
    cliHost: null as string | null,
    cliResumeCursor: null,
    acpSession: null as unknown,
    cliPaneBindings: {},
    focusedFilePath: null,
    resultUnseen: false,
    accountId: null,
    swarmParentId: null,
    swarmLayout: null,
    swarmLayoutFull: null,
    compactions: [],
    hostTranscripts: {}
  }
}

function userMessage(id: string, parentId: string | null, text: string, createdAt: number) {
  return {
    id,
    parentId,
    role: 'user',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt
  }
}

/** Sealed VAV / ACP-shaped transcript: tools, plan, error, ask. */
export function buildAgentConversation(workspace: string, now = Date.now()) {
  const hello = join(workspace, 'hello.md')
  const note = join(workspace, 'note.md')
  const conversation = baseConversation(now, workspace)
  conversation.tokensUsed = 4_200
  conversation.messages = [
    userMessage(USER_1, null, 'Inspect hello.md and draft a note.', now),
    {
      id: ASST_1,
      parentId: USER_1,
      role: 'assistant',
      content: 'e2e agent conclusion',
      createdAt: now + 1,
      blocks: [
        {
          kind: 'reasoning',
          text: 'I will read the file, then write a short note.',
          durationMs: 1_200
        },
        {
          kind: 'toolCall',
          id: 'e2e-read',
          tool: 'fs_read',
          summary: hello,
          input: JSON.stringify({ path: hello }),
          output: '# hello from e2e\n',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: 'e2e-write',
          tool: 'fs_write',
          summary: note,
          input: JSON.stringify({ path: note, contents: 'draft\n' }),
          output: 'wrote note.md',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: 'e2e-plan',
          tool: 'plan',
          summary: 'Ship e2e',
          input: JSON.stringify({
            title: 'Ship e2e',
            steps: [
              { id: 's1', title: 'Read hello', status: 'done' },
              { id: 's2', title: 'Write note', status: 'executing' },
              { id: 's3', title: 'Reply', status: 'pending' }
            ]
          }),
          output: '',
          status: 'executing'
        },
        {
          kind: 'toolCall',
          id: 'e2e-plan-doc',
          tool: 'plan_doc',
          summary: 'E2E plan doc',
          input: JSON.stringify({
            name: 'E2E plan doc',
            overview: 'Seeded reviewable plan.',
            plan: '## Steps\n\n- Cover agent output\n- Cover ACP slash'
          }),
          output: 'accepted',
          status: 'completed'
        },
        { kind: 'text', text: 'e2e agent conclusion' }
      ]
    },
    userMessage(USER_2, ASST_1, 'That write failed?', now + 2),
    {
      id: ASST_2,
      parentId: USER_2,
      role: 'assistant',
      content: 'e2e turn failed',
      createdAt: now + 3,
      errorText: 'e2e turn failed',
      errorDetail: 'stub provider error',
      blocks: [{ kind: 'text', text: '> e2e turn failed' }]
    },
    userMessage(USER_3, ASST_2, 'Which next step?', now + 4),
    {
      id: ASST_3,
      parentId: USER_3,
      role: 'assistant',
      content: '',
      createdAt: now + 5,
      blocks: [
        {
          kind: 'toolCall',
          id: 'e2e-ask',
          tool: 'ask_user_question',
          summary: 'Pick a next step',
          input: JSON.stringify({
            question: 'Pick a next step',
            choices: ['Keep writing', 'Open review']
          }),
          output: '',
          status: 'pending',
          questions: [
            {
              question: 'Pick a next step',
              choices: ['Keep writing', 'Open review']
            }
          ]
        }
      ]
    }
  ]
  conversation.activeLeafId = ASST_3
  return conversation
}

/**
 * Live ACP host (cursor transport). Session state arrives from session/new
 * after the first prompt — do not pre-seed acpSession.
 */
export function buildAcpLiveConversation(workspace: string, now = Date.now()) {
  const conversation = baseConversation(now, workspace)
  conversation.title = 'E2E ACP live'
  conversation.cliHost = 'cursor'
  conversation.agentBinaryName = 'cursor'
  conversation.acpSession = null
  return conversation
}

/** ACP chrome on a VAV chat surface — no live CLI host process. */
export function buildAcpConversation(workspace: string, now = Date.now()) {
  const conversation = baseConversation(now, workspace)
  conversation.cliHost = 'claude'
  conversation.agentBinaryName = 'claude'
  conversation.acpSession = {
    currentModeId: 'agent',
    modes: [
      { id: 'agent', name: 'Agent', description: 'Full edit' },
      { id: 'plan', name: 'Plan', description: 'Read-only plan' }
    ],
    commands: [
      { name: 'compact', description: 'Compact this session' },
      { name: 'cost', description: 'Show session cost' }
    ],
    configOptions: [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'agent',
        options: [
          { value: 'agent', name: 'Agent' },
          { value: 'plan', name: 'Plan' }
        ]
      }
    ],
    sessionTitle: 'E2E ACP'
  }
  return conversation
}

/** Branch, quote, subtask, cancelled, approval, request — extra agent chrome. */
export function buildRichConversation(workspace: string, now = Date.now()) {
  const hello = join(workspace, 'hello.md')
  const conversation = baseConversation(now, workspace)
  conversation.tokensUsed = 8_800
  conversation.messages = [
    userMessage(USER_1, null, 'Give me two takes.', now),
    {
      id: ASST_1,
      parentId: USER_1,
      role: 'assistant',
      content: 'branch A conclusion',
      createdAt: now + 1,
      blocks: [{ kind: 'text', text: 'branch A conclusion' }]
    },
    {
      id: 'e2e-asst-1b',
      parentId: USER_1,
      role: 'assistant',
      content: 'branch B conclusion',
      createdAt: now + 2,
      blocks: [{ kind: 'text', text: 'branch B conclusion' }]
    },
    {
      id: USER_2,
      parentId: 'e2e-asst-1b',
      role: 'user',
      content: 'Follow the second take.',
      createdAt: now + 3,
      quoteMessageId: 'e2e-asst-1b',
      quoteSummary: 'branch B conclusion',
      quoteRole: 'assistant',
      blocks: [{ kind: 'text', text: 'Follow the second take.' }]
    },
    {
      id: ASST_2,
      parentId: USER_2,
      role: 'assistant',
      content: 'subagent wrapped up',
      createdAt: now + 4,
      blocks: [
        {
          kind: 'toolCall',
          id: 'e2e-task',
          tool: 'task',
          summary: 'Research hello',
          input: JSON.stringify({ prompt: 'Look up hello.md' }),
          output: 'subagent wrapped up',
          status: 'executing',
          children: [
            {
              kind: 'reasoning',
              text: 'Searching the web for context.',
              durationMs: 400
            },
            {
              kind: 'toolCall',
              id: 'e2e-search',
              tool: 'web_search',
              summary: 'hello.md',
              input: JSON.stringify({ query: 'hello.md' }),
              output: '1 hit',
              status: 'completed'
            },
            { kind: 'text', text: 'Found the file in the workspace.' }
          ]
        },
        {
          kind: 'toolCall',
          id: 'e2e-skill',
          tool: 'load_skill',
          summary: 'e2e-skill',
          input: JSON.stringify({ name: 'e2e-skill' }),
          output: 'loaded',
          status: 'completed'
        }
      ]
    },
    userMessage(USER_3, ASST_2, 'Stop that.', now + 5),
    {
      id: ASST_3,
      parentId: USER_3,
      role: 'assistant',
      content: '',
      createdAt: now + 6,
      cancelled: true,
      blocks: [{ kind: 'text', text: 'partial…' }]
    },
    userMessage('e2e-user-4', ASST_3, 'Write it anyway.', now + 7),
    {
      id: 'e2e-asst-4',
      parentId: 'e2e-user-4',
      role: 'assistant',
      content: '',
      createdAt: now + 8,
      blocks: [
        {
          kind: 'toolCall',
          id: 'e2e-approve',
          tool: 'fs_write',
          summary: `Write ${hello}`,
          input: JSON.stringify({ path: hello, contents: 'patched\n' }),
          output: '',
          status: 'pending',
          choices: ['Approve', 'Deny']
        }
      ]
    },
    userMessage('e2e-user-5', 'e2e-asst-4', 'Also confirm the host request.', now + 9),
    {
      id: 'e2e-asst-5',
      parentId: 'e2e-user-5',
      role: 'assistant',
      content: '',
      createdAt: now + 10,
      blocks: [
        {
          kind: 'toolCall',
          id: 'e2e-request',
          tool: 'request',
          summary: 'Allow network for this search?',
          input: JSON.stringify({ reason: 'web_search' }),
          output: '',
          status: 'pending'
        }
      ]
    }
  ]
  conversation.activeLeafId = 'e2e-asst-5'
  return conversation
}

export function buildEmptyConversation(workspace: string, now = Date.now()) {
  return baseConversation(now, workspace)
}

export function buildNamedSession(
  workspace: string,
  id: string,
  title: string,
  now = Date.now()
) {
  const conversation = baseConversation(now, workspace)
  conversation.id = id
  conversation.title = title
  return conversation
}

export function buildSeededConversation(
  kind: SeedConversationKind,
  workspace: string,
  now = Date.now()
) {
  if (kind === 'agent') return buildAgentConversation(workspace, now)
  if (kind === 'acp') return buildAcpConversation(workspace, now)
  if (kind === 'acp-live') return buildAcpLiveConversation(workspace, now)
  if (kind === 'rich') return buildRichConversation(workspace, now)
  return buildEmptyConversation(workspace, now)
}
