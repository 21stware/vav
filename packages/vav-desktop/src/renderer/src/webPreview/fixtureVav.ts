import type { Bootstrap, FileInspectResult, NativeMenuItem, VavApi } from '@shared/ipc'
import { emptyGitSnapshot } from '@shared/git'
import { LOCAL_MACHINE_ID, LOCAL_MACHINE_LABEL } from '@shared/workspaceHost'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Conversation,
  type ConversationMeta,
  type DirectoryListing,
  type FileEntry,
  type TurnStatus
} from '@shared/types'
import { emptyUsageTotals } from '@shared/analysis'
import { codeFonts } from '@shared/platform'
import {
  WEB_PREVIEW_HOME,
  WEB_PREVIEW_WORKSPACE,
  activeIdForScene,
  conversationsForScene,
  previewConversation,
  type WebPreviewScene
} from './scenes'

const PREVIEW_FILES: Record<string, string> = {
  [`${WEB_PREVIEW_WORKSPACE}/README.md`]:
    '# Preview project\n\nFixture tree for `npm run dev:web`. Not a real workspace.\n',
  [`${WEB_PREVIEW_WORKSPACE}/notes.md`]: 'Web preview notes.\n',
  [`${WEB_PREVIEW_WORKSPACE}/src/app.tsx`]: 'export function App() {\n  return <main>preview</main>\n}\n'
}

function fileEntry(path: string, name: string, isDirectory: boolean): FileEntry {
  return {
    path,
    name,
    isDirectory,
    size: isDirectory ? 0 : (PREVIEW_FILES[path]?.length ?? 0),
    modifiedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    children: isDirectory ? null : undefined
  }
}

function listingFor(path: string): DirectoryListing {
  const normalized = path.replace(/\/+$/, '') || '/'
  if (normalized === WEB_PREVIEW_HOME) {
    return {
      path: normalized,
      entries: [fileEntry(WEB_PREVIEW_WORKSPACE, 'project', true)],
      truncated: 0
    }
  }
  if (normalized === WEB_PREVIEW_WORKSPACE) {
    return {
      path: normalized,
      entries: [
        fileEntry(`${WEB_PREVIEW_WORKSPACE}/README.md`, 'README.md', false),
        fileEntry(`${WEB_PREVIEW_WORKSPACE}/notes.md`, 'notes.md', false),
        fileEntry(`${WEB_PREVIEW_WORKSPACE}/src`, 'src', true)
      ],
      truncated: 0
    }
  }
  if (normalized === `${WEB_PREVIEW_WORKSPACE}/src`) {
    return {
      path: normalized,
      entries: [fileEntry(`${WEB_PREVIEW_WORKSPACE}/src/app.tsx`, 'app.tsx', false)],
      truncated: 0
    }
  }
  return { path: normalized, entries: [], truncated: 0, error: 'ENOENT' }
}

function inspectPath(path: string): FileInspectResult {
  const text = PREVIEW_FILES[path]
  const name = path.split('/').pop() || path
  if (text == null) {
    return {
      path,
      name,
      size: 0,
      kind: 'binary',
      mime: 'application/octet-stream',
      error: 'ENOENT'
    }
  }
  return {
    path,
    name,
    size: text.length,
    mtimeMs: 1_700_000_000_000,
    kind: 'text',
    mime: 'text/plain',
    text,
    lineCount: text.split('\n').length
  }
}

function toMeta(conversation: Conversation): ConversationMeta {
  return conversation
}

function idleStatus(conversationId: string): TurnStatus {
  return {
    conversationId,
    isRunning: false,
    phase: 'idle',
    toolCount: 0,
    awaitingToolCallId: null,
    messageId: null,
    blocks: []
  }
}

function defaultFor(name: string): unknown {
  if (/^on[A-Z]/.test(name)) return () => undefined
  if (/^(list|query|discovered|availableFonts|fileAssociations)/.test(name)) return []
  if (/^(is|has|peek)/.test(name)) return false
  if (name === 'pathForFile') return ''
  return undefined
}

function stubLeaf(label: string): unknown {
  const leaf = label.split('.').pop() || label
  const apply = (..._args: unknown[]): unknown => {
    if (/^on[A-Z]/.test(leaf)) return () => undefined
    if (
      /^(write|resize|kill|ready|painted|dismiss|cancel|seen|startDrag|setKey|record)$/.test(leaf)
    ) {
      return undefined
    }
    const value = defaultFor(leaf)
    return value instanceof Function ? value : Promise.resolve(value ?? null)
  }
  return new Proxy(apply, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop === 'symbol') return undefined
      return stubLeaf(`${label}.${String(prop)}`)
    },
    apply(_target, _thisArg, argArray) {
      return apply(...argArray)
    }
  })
}

function withFallback<T extends object>(explicit: T, label: string): T {
  return new Proxy(explicit, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
      if (prop in target) return Reflect.get(target, prop, receiver)
      return stubLeaf(`${label}.${String(prop)}`)
    }
  })
}

async function popupMenu(
  items: NativeMenuItem[],
  position?: { x: number; y: number }
): Promise<string | null> {
  if (typeof document === 'undefined') return null
  const { showDomMenu } = await import('../lib/domMenu')
  return showDomMenu(items, position)
}

export function createFixtureVav(options?: {
  scene?: WebPreviewScene
  now?: number
}): VavApi {
  const scene = options?.scene ?? 'chat'
  const now = options?.now ?? 1_700_000_000_000
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    apiKeyPresent: scene !== 'empty',
    defaultWorkingDirectory: WEB_PREVIEW_WORKSPACE,
    recentWorkspaceDirectories:
      scene === 'empty' ? [] : [{ machineId: LOCAL_MACHINE_ID, path: WEB_PREVIEW_WORKSPACE }]
  }
  const conversations = conversationsForScene(scene, now)
  let nextId = 1

  const bootstrap = async (): Promise<Bootstrap> => ({
    settings: { ...settings },
    resolvedLocale: 'zh-CN',
    systemAccentColor: '#007aff',
    conversations: conversations.map(toMeta),
    activeConversationId: activeIdForScene(scene),
    apiKeyHint: settings.apiKeyPresent ? 'sk-••••preview' : null,
    platform: 'darwin',
    home: WEB_PREVIEW_HOME,
    tmp: '/tmp/vav-preview',
    about: {
      version: 'web-preview',
      vavServerVersion: 'web-preview',
      buildNumber: '0',
      electron: '0',
      userDataPath: '/tmp/vav-preview-data',
      conversationsPath: '/tmp/vav-preview-data/conversations'
    },
    hosts: [
      {
        id: LOCAL_MACHINE_ID,
        name: LOCAL_MACHINE_LABEL,
        kind: 'local',
        online: true,
        platform: 'darwin',
        home: WEB_PREVIEW_HOME,
        tmp: '/tmp/vav-preview',
        defaultPath: WEB_PREVIEW_WORKSPACE,
        controlPlane: true
      }
    ]
  })

  const api = {
    platform: 'darwin' as const,
    bootstrap,
    secrets: withFallback(
      {
        status: async () => ({
          unlocked: true,
          needsUnlock: false,
          encryptionAvailable: false,
          hasKeyFile: false,
          onboardingComplete: true
        }),
        unlock: async () => ({ ok: true as const })
      },
      'vav.secrets'
    ),
    settings: withFallback(
      {
        get: async () => ({ ...settings }),
        update: async (patch: Partial<AppSettings>) => {
          Object.assign(settings, patch)
          return { ...settings }
        },
        reset: async () => {
          Object.assign(settings, DEFAULT_SETTINGS)
          return { ...settings }
        },
        availableFonts: async () => codeFonts('darwin'),
        appPaths: async () => null,
        analysis: async () => {
          const totals = emptyUsageTotals()
          return {
            usage: {
              total: totals,
              api: totals,
              agent: totals,
              hosts: [],
              turns: [],
              byModel: [],
              byAccount: []
            },
            providers: [],
            now
          }
        },
        keepAwakeStatus: async () => ({
          lidSupported: false,
          granted: false,
          idleBlocked: false,
          lidSleepBlocked: false,
          onBattery: false,
          batteryPercent: 100,
          lowPowerMode: false,
          safetyHold: null,
          hasWork: false
        }),
        fileAssociations: async () => [],
        cliStatus: async () => ({
          installed: false,
          path: null,
          preferredLocation: '~/.local/bin' as const,
          pathInPath: false,
          version: null,
          installedAt: null
        })
      },
      'vav.settings'
    ),
    conversations: withFallback(
      {
      list: async () => conversations.map(toMeta),
      get: async (id: string) => conversations.find((row) => row.id === id) ?? null,
      create: async () => {
        const id = `preview-new-${nextId++}`
        const row: Conversation = {
          ...previewConversation(now),
          id,
          title: 'New session',
          tokensUsed: 0,
          createdAt: now,
          updatedAt: now,
          messages: [],
          activeLeafId: null
        }
        conversations.unshift(row)
        return toMeta(row)
      },
      rename: async (id: string, title: string) => {
        const row = conversations.find((item) => item.id === id)
        if (row) {
          row.title = title
          row.updatedAt = now
        }
        return conversations.map(toMeta)
      }
      },
      'vav.conversations'
    ),
    agent: withFallback(
      {
        status: async (conversationId: string) => idleStatus(conversationId),
        send: async () => undefined,
        onEvent: () => () => undefined
      },
      'vav.agent'
    ),
    agents: withFallback(
      {
        getModelCatalog: async () => ({}),
        preloadModels: async () => ({})
      },
      'vav.agents'
    ),
    files: withFallback(
      {
        list: async (path: string) => listingFor(path),
        read: async (path: string) => {
          const text = PREVIEW_FILES[path]
          return text == null
            ? { content: '', truncated: false, error: 'ENOENT' }
            : { content: text, truncated: false }
        },
        inspect: async (path: string) => inspectPath(path),
        pathForFile: () => '',
        watch: async () => undefined,
        onDirty: () => () => undefined,
        screenshotPermission: async () => 'granted' as const
      },
      'vav.files'
    ),
    git: withFallback(
      {
        status: async (cwd: string) => emptyGitSnapshot(cwd)
      },
      'vav.git'
    ),
    pty: withFallback(
      {
        list: async () => ({ sessions: [], layouts: {} }),
        write: () => undefined,
        resize: () => undefined
      },
      'vav.pty'
    ),
    hosts: withFallback(
      {
        list: async () => (await bootstrap()).hosts,
        active: async () => LOCAL_MACHINE_ID,
        pairing: async () => null,
        incoming: async () => [],
        home: async () => WEB_PREVIEW_HOME,
        listDir: async (_machineId: string, path: string) => listingFor(path),
        onChanged: () => () => undefined
      },
      'vav.hosts'
    ),
    updates: withFallback(
      {
        getState: async () => ({
          phase: 'idle' as const,
          currentVersion: 'web-preview',
          latestVersion: null,
          releaseUrl: null,
          downloadUrl: null,
          progress: 0,
          bytesPerSecond: null,
          message: null
        })
      },
      'vav.updates'
    ),
    accounts: withFallback(
      {
        getPage: async () => ({
          workspaceKey: 'local',
          workspaceLabel: LOCAL_MACHINE_LABEL,
          groups: [],
          accounts: [],
          usage: []
        })
      },
      'vav.accounts'
    ),
    window: withFallback(
      {
        setMinSize: async () => undefined,
        popupMenu,
        closePopupMenu: async () => undefined,
        peekPopupMenu: async () => null,
        openSettings: async () => {
          if (typeof location === 'undefined') return
          const url = new URL(location.href)
          url.searchParams.set('view', 'settings')
          location.assign(url.toString())
        },
        onRepaint: () => () => undefined
      },
      'vav.window'
    ),
    computer: withFallback(
      {
        status: async () => ({
          enabled: false,
          available: false,
          binaryPresent: false,
          running: false,
          error: null,
          accessibility: 'not-determined' as const,
          screenRecording: 'granted' as const
        })
      },
      'vav.computer'
    ),
    logs: withFallback(
      {
        query: async () => [],
        record: async () => undefined,
        onChanged: () => () => undefined
      },
      'vav.logs'
    ),
    onCliOpen: () => () => undefined,
    onSettingsView: () => () => undefined
  }

  return withFallback(api, 'vav') as unknown as VavApi
}

const PREVIEW_STYLES = `
html[data-web-preview] , html[data-web-preview] body, html[data-web-preview] #root {
  background: var(--preview-shell-bg, #121213) !important;
}
.vav-web-preview-badge {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 80;
  pointer-events: none;
  font: 11px/1.2 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  color: rgba(255,255,255,0.72);
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 999px;
  padding: 4px 8px;
}
.vav-dom-menu {
  position: fixed;
  z-index: 90;
  min-width: 168px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 16px));
  overflow: auto;
  padding: 6px;
  border-radius: 10px;
  background: var(--bg-raised, #1c1c1e);
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  box-shadow: 0 12px 40px rgba(0,0,0,0.28);
}
.vav-dom-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  border-radius: 6px;
  padding: 6px 8px;
}
.vav-dom-menu-item:hover:not(:disabled) {
  background: rgba(0, 122, 255, 0.16);
}
.vav-dom-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: rgba(255,255,255,0.08);
}
.vav-dom-menu-header {
  padding: 6px 8px 2px;
  font-size: 11px;
  opacity: 0.55;
}
`

export function applyWebPreviewDocument(
  doc: Document = document,
  options?: { live?: boolean }
): void {
  const live = options?.live === true
  const root = doc.documentElement
  root.dataset.webPreview = 'true'
  root.dataset.observeLive = live ? 'true' : 'false'
  delete root.dataset.vibrancy
  const dark =
    root.dataset.theme === 'dark' ||
    (root.dataset.theme !== 'light' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  root.style.setProperty('--preview-shell-bg', dark ? '#121213' : '#ececee')
  root.style.background = dark ? '#121213' : '#ececee'
  const title = live ? 'vav (live observe)' : 'vav (web preview)'
  if (doc.title && !doc.title.includes('web preview') && !doc.title.includes('live observe')) {
    doc.title = title
  } else if (live) {
    doc.title = title
  }
  if (!doc.getElementById('vav-web-preview-styles')) {
    const style = doc.createElement('style')
    style.id = 'vav-web-preview-styles'
    style.textContent = PREVIEW_STYLES
    doc.head.appendChild(style)
  }
  const badge = doc.querySelector('.vav-web-preview-badge') as HTMLElement | null
  if (badge) {
    badge.textContent = live ? 'live observe' : 'web preview'
  } else {
    const next = doc.createElement('div')
    next.className = 'vav-web-preview-badge'
    next.textContent = live ? 'live observe' : 'web preview'
    doc.body?.appendChild(next)
  }
}
