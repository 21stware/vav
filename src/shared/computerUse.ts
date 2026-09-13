/**
 * Computer-use contract for the embedded Cua Driver.
 *
 * VAV.app owns the daemon (TCC). The agent never moves the real pointer,
 * never activates a window, and must bind every action to one pid + window.
 */

export const VAV_CUA_CONNECTION_ENV = 'VAV_CUA_CONNECTION'
export const VAV_BUNDLE_ID = 'com.vav.app'

export type ComputerActKind = 'click' | 'type' | 'key' | 'launch'

export type ComputerActInput = {
  kind?: unknown
  pid?: unknown
  window_id?: unknown
  windowId?: unknown
  element_index?: unknown
  elementIndex?: unknown
  element_token?: unknown
  elementToken?: unknown
  snapshot_id?: unknown
  snapshotId?: unknown
  x?: unknown
  y?: unknown
  text?: unknown
  key?: unknown
  bundle_id?: unknown
  bundleId?: unknown
  delivery_mode?: unknown
  deliveryMode?: unknown
  activate?: unknown
  scope?: unknown
}

export type ComputerObserveInput = {
  pid?: unknown
  window_id?: unknown
  windowId?: unknown
  query?: unknown
}

export type ComputerPermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export type ComputerUseStatus = {
  enabled: boolean
  available: boolean
  binaryPresent: boolean
  running: boolean
  error: string | null
  accessibility: ComputerPermissionState
  screenRecording: ComputerPermissionState
}

export type CuaConnectionFile = {
  socketPath: string
  binPath: string
  generation: number
  startedAt: string
}

export type ComputerPolicyOk = {
  ok: true
  tool: string
  payload: Record<string, unknown>
}

export type ComputerPolicyErr = {
  ok: false
  error: string
}

export type ComputerPolicyResult = ComputerPolicyOk | ComputerPolicyErr

function asFiniteInt(value: unknown): number | null {
  if (typeof value === 'bigint') {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

export function computerWindowId(input: { window_id?: unknown; windowId?: unknown }): number | null {
  return asFiniteInt(input.window_id ?? input.windowId)
}

export function computerPid(input: { pid?: unknown }): number | null {
  const pid = asFiniteInt(input.pid)
  return pid != null && pid > 0 ? pid : null
}

/** ACP `session/new` stdio MCP server (Cursor / Grok / other ACP hosts). */
export type AcpMcpServer = {
  type: 'stdio'
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

/** Point an ACP host at VAV.app's embedded daemon — never `--direct` (that steals TCC). */
export function cuaEmbeddedMcpServer(conn: CuaConnectionFile): AcpMcpServer {
  return {
    type: 'stdio',
    name: 'vav-computer',
    command: conn.binPath,
    args: [
      'mcp',
      '--embedded',
      '--socket',
      conn.socketPath,
      '--host-bundle-id',
      VAV_BUNDLE_ID
    ],
    env: []
  }
}

export function parseCuaConnection(raw: unknown): CuaConnectionFile | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const socketPath = asNonEmptyString(rec.socketPath)
  const binPath = asNonEmptyString(rec.binPath)
  const generation = asFiniteInt(rec.generation)
  const startedAt = asNonEmptyString(rec.startedAt)
  if (!socketPath || !binPath || generation == null || !startedAt) return null
  return { socketPath, binPath, generation, startedAt }
}

/** List / observe are reads. Actions never leave this allow-list. */
export const COMPUTER_ACT_TOOLS: Record<ComputerActKind, string> = {
  click: 'click',
  type: 'type_text',
  key: 'press_key',
  launch: 'launch_app'
}

export function sanitizeComputerObserve(input: ComputerObserveInput): ComputerPolicyResult {
  const pid = computerPid(input)
  const windowId = computerWindowId(input)
  if (pid == null || windowId == null) {
    return { ok: false, error: 'computer_observe requires pid and window_id from computer_list.' }
  }
  const payload: Record<string, unknown> = { pid, window_id: windowId }
  const query = asNonEmptyString(input.query)
  if (query) payload.query = query
  return { ok: true, tool: 'get_window_state', payload }
}

export function sanitizeComputerAct(
  input: ComputerActInput,
  options?: { allowForeground?: boolean }
): ComputerPolicyResult {
  if (input.activate === true) {
    return { ok: false, error: 'Refused: computer actions must not activate or front a window.' }
  }
  const scope = asNonEmptyString(input.scope)
  if (scope && scope !== 'window') {
    return { ok: false, error: 'Refused: desktop-scope input is disabled. Bind pid and window_id.' }
  }
  const requestedMode = asNonEmptyString(input.delivery_mode ?? input.deliveryMode)
  if (requestedMode === 'foreground' && !options?.allowForeground) {
    return {
      ok: false,
      error:
        'Refused: foreground delivery is disabled. Stay on background (no focus steal). If the action did not land, ask the user.'
    }
  }

  const kindRaw = asNonEmptyString(input.kind)
  if (kindRaw !== 'click' && kindRaw !== 'type' && kindRaw !== 'key' && kindRaw !== 'launch') {
    return { ok: false, error: 'computer_act kind must be click, type, key, or launch.' }
  }
  const kind = kindRaw

  const payload: Record<string, unknown> = { delivery_mode: 'background' }

  if (kind === 'launch') {
    const bundleId = asNonEmptyString(input.bundle_id ?? input.bundleId)
    if (!bundleId) return { ok: false, error: 'launch requires bundle_id.' }
    payload.bundle_id = bundleId
    return { ok: true, tool: COMPUTER_ACT_TOOLS.launch, payload }
  }

  const pid = computerPid(input)
  const windowId = computerWindowId(input)
  if (pid == null || windowId == null) {
    return { ok: false, error: 'computer_act requires pid and window_id from computer_list / observe.' }
  }
  payload.pid = pid
  payload.window_id = windowId

  const elementToken = asNonEmptyString(input.element_token ?? input.elementToken)
  const snapshotId = asNonEmptyString(input.snapshot_id ?? input.snapshotId)
  const elementIndex = asFiniteInt(input.element_index ?? input.elementIndex)
  const x = typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : null
  const y = typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : null

  if (elementToken) payload.element_token = elementToken
  if (elementIndex != null && snapshotId) {
    payload.element_index = elementIndex
    payload.snapshot_id = snapshotId
  } else if (elementIndex != null && !snapshotId && !elementToken) {
    return { ok: false, error: 'element_index requires snapshot_id from the latest computer_observe.' }
  }

  if (kind === 'click') {
    const hasElement = Boolean(elementToken || (elementIndex != null && snapshotId))
    const hasPixel = x != null && y != null
    if (!hasElement && !hasPixel) {
      return {
        ok: false,
        error: 'click needs element_token (preferred) or element_index+snapshot_id, or x+y from the window screenshot.'
      }
    }
    if (!hasElement && hasPixel) {
      payload.x = x
      payload.y = y
    }
    return { ok: true, tool: COMPUTER_ACT_TOOLS.click, payload }
  }

  if (kind === 'type') {
    const text = typeof input.text === 'string' ? input.text : null
    if (text == null) return { ok: false, error: 'type requires text.' }
    payload.text = text
    if (x != null && y != null && !elementToken && elementIndex == null) {
      payload.x = x
      payload.y = y
    }
    return { ok: true, tool: COMPUTER_ACT_TOOLS.type, payload }
  }

  const key = asNonEmptyString(input.key)
  if (!key) return { ok: false, error: 'key requires key (e.g. Return, Escape, down).' }
  payload.key = key
  return { ok: true, tool: COMPUTER_ACT_TOOLS.key, payload }
}

/** A running application the composer can @-mention for computer use. */
export type ComputerApp = {
  name: string
  bundleId: string | null
  pid: number | null
}

function pickString(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asNonEmptyString(rec[key])
    if (value) return value
  }
  return null
}

/**
 * Normalize the cua daemon's `list_apps` output into a stable app list.
 *
 * The daemon's exact JSON shape is owned by cua-driver and may evolve, so this
 * parser is deliberately permissive: it accepts a bare array, `{ apps: [...] }`,
 * or `{ items/windows: [...] }`, and reads the app name / bundle id / pid from
 * any of several common field spellings. Anything unparseable yields `[]` so
 * the menu degrades to empty rather than throwing.
 */
export function parseComputerApps(raw: unknown): ComputerApp[] {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return []
    }
  }
  let rows: unknown[]
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    const list = rec.apps ?? rec.applications ?? rec.items ?? rec.windows ?? rec.result
    rows = Array.isArray(list) ? list : []
  } else {
    rows = []
  }

  const byKey = new Map<string, ComputerApp>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const name = pickString(rec, [
      'name',
      'app_name',
      'appName',
      'localizedName',
      'localized_name',
      'title',
      'app',
      'owner'
    ])
    if (!name) continue
    const bundleId = pickString(rec, ['bundleId', 'bundle_id', 'bundle', 'bundle_identifier'])
    const pid = asFiniteInt(rec.pid ?? rec.process_id ?? rec.processId)
    const dedupeKey = bundleId ?? name.toLowerCase()
    if (!byKey.has(dedupeKey)) {
      byKey.set(dedupeKey, { name, bundleId, pid: pid ?? null })
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
