/**
 * ACP v1 session / prompt / elicitation types shared by main and renderer.
 * @see https://agentclientprotocol.com/protocol/v1/schema
 */

export const ACP_PROTOCOL_VERSION = 1

/** Capabilities VAV advertises as an ACP client. */
export const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
  elicitation: { form: {}, url: {} },
  /** Interactive PTY login is not implemented — do not advertise it. */
  auth: { terminal: false },
  session: { configOptions: { boolean: {} } }
} as const

export interface AcpSessionMode {
  id: string
  name: string
  description?: string
}

export interface AcpAvailableCommand {
  name: string
  description?: string
  hint?: string
}

export interface AcpConfigOptionValue {
  value: string
  name: string
  description?: string
}

export interface AcpConfigOption {
  id: string
  name: string
  description?: string
  category?: string
  type: 'select' | 'boolean'
  currentValue: string | boolean
  options?: AcpConfigOptionValue[]
}

export interface AcpAuthMethod {
  id: string
  name: string
  description?: string
  type?: 'agent' | 'terminal' | string
  args?: string[]
  env?: Record<string, string>
}

export interface AcpPromptCapabilities {
  image: boolean
  audio: boolean
  embeddedContext: boolean
}

export type GoalAction = 'set' | 'pause' | 'resume' | 'clear'
export type GoalStatus = 'active' | 'paused' | 'blocked' | 'limited' | 'complete'

export const GOAL_ACTIONS: readonly GoalAction[] = ['set', 'pause', 'resume', 'clear']

/** Grok Build `/goal` surface — also used when a host advertises the command. */
export const GROK_GOAL_COMMAND: AcpAvailableCommand = {
  name: 'goal',
  description: 'Set a long-running goal; pause / resume / clear / status',
  hint: '<objective> | pause | resume | clear | status'
}

export interface GoalCapability {
  version: number
  /** `_session/goal` for the ACP extension, or `slash` for `/goal` prompts. */
  controlMethod: string
  /** Actions the UI may offer. */
  actions: GoalAction[]
  /** Subset actually accepted by `controlMethod`. Others use `/goal` slash. */
  methodActions?: GoalAction[]
}

export interface GoalSnapshot {
  objective: string
  status: GoalStatus
  createdAt?: number
  updatedAt?: number
  iterations?: number
  lastReason?: string
  tokenBudget?: number | null
  tokensUsed?: number
  timeUsedSeconds?: number
}

export interface AcpSessionState {
  currentModeId?: string | null
  modes?: AcpSessionMode[]
  commands?: AcpAvailableCommand[]
  configOptions?: AcpConfigOption[]
  sessionTitle?: string | null
  /** Cursor thinking levels this model actually accepts. */
  thinkingLevels?: Array<'off' | 'low' | 'medium' | 'high' | 'max'>
  goalCapability?: GoalCapability | null
  /** Session-scoped goal. `null` clears; omit to leave unchanged on merge. */
  goal?: GoalSnapshot | null
}

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string; uri?: string }
  | {
      type: 'resource_link'
      uri: string
      name: string
      mimeType?: string
      title?: string
    }
  | {
      type: 'resource'
      resource: { uri: string; mimeType?: string; text?: string; blob?: string }
    }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

export function parseAcpAuthMethods(raw: unknown): AcpAuthMethod[] {
  const rows = asArray(raw) ?? []
  const out: AcpAuthMethod[] = []
  for (const item of rows) {
    const rec = asRecord(item)
    const id = asString(rec?.id)
    if (!id) continue
    const envRec = asRecord(rec?.env)
    const env: Record<string, string> = {}
    if (envRec) {
      for (const [key, value] of Object.entries(envRec)) {
        if (typeof value === 'string') env[key] = value
      }
    }
    const args = asArray(rec?.args)
      ?.map((part) => (typeof part === 'string' ? part : null))
      .filter((part): part is string => part != null)
    out.push({
      id,
      name: asString(rec?.name) || id,
      description: asString(rec?.description) ?? undefined,
      type: asString(rec?.type) || 'agent',
      args: args?.length ? args : undefined,
      env: Object.keys(env).length ? env : undefined
    })
  }
  return out
}

export function parseAcpPromptCapabilities(raw: unknown): AcpPromptCapabilities {
  const rec = asRecord(raw) ?? {}
  return {
    image: rec.image === true,
    audio: rec.audio === true,
    embeddedContext: rec.embeddedContext === true || rec.embedded_context === true
  }
}

/**
 * Grok `session/new._meta["x.ai/sessionConfig"]`.
 * `category: "mode"` is reasoning effort — never ACP plan/agent modes.
 */
export function parseGrokSessionConfig(raw: unknown): {
  thinkingLevels: Array<'low' | 'medium' | 'high'>
  currentThinking: 'low' | 'medium' | 'high' | null
  currentModelId: string | null
} {
  const rec = asRecord(raw)
  const list = asArray(rec?.options) ?? []
  const thinkingLevels: Array<'low' | 'medium' | 'high'> = []
  let currentThinking: 'low' | 'medium' | 'high' | null = null
  let currentModelId: string | null = null
  for (const item of list) {
    const row = asRecord(item)
    const id = asString(row?.id)
    if (!id) continue
    const category = asString(row?.category)
    if (category === 'mode' && (id === 'low' || id === 'medium' || id === 'high')) {
      if (!thinkingLevels.includes(id)) thinkingLevels.push(id)
      if (row?.selected === true) currentThinking = id
    }
    if (category === 'model' && row?.selected === true) currentModelId = id
  }
  const order: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']
  return {
    thinkingLevels: order.filter((level) => thinkingLevels.includes(level)),
    currentThinking,
    currentModelId
  }
}

export function parseAcpSessionModes(raw: unknown): {
  currentModeId: string | null
  modes: AcpSessionMode[]
} {
  const rec = asRecord(raw)
  const list = asArray(rec?.availableModes) ?? asArray(rec?.available_modes) ?? asArray(raw)
  const modes: AcpSessionMode[] = []
  for (const item of list ?? []) {
    const row = asRecord(item)
    const id = asString(row?.id)
    if (!id) continue
    modes.push({
      id,
      name: asString(row?.name) || id,
      description: asString(row?.description) ?? undefined
    })
  }
  return {
    currentModeId: asString(rec?.currentModeId) || asString(rec?.current_mode_id) || modes[0]?.id || null,
    modes
  }
}

export function parseAcpAvailableCommands(raw: unknown): AcpAvailableCommand[] {
  const list =
    asArray(raw) ??
    asArray(asRecord(raw)?.availableCommands) ??
    asArray(asRecord(raw)?.available_commands) ??
    []
  const out: AcpAvailableCommand[] = []
  for (const item of list) {
    const rec = asRecord(item)
    const name = asString(rec?.name)
    if (!name) continue
    const input = asRecord(rec?.input)
    out.push({
      name: name.replace(/^\//, ''),
      description: asString(rec?.description) ?? undefined,
      hint: asString(input?.hint) ?? asString(rec?.hint) ?? undefined
    })
  }
  return out
}

export function parseAcpConfigOptions(raw: unknown): AcpConfigOption[] {
  const list =
    asArray(raw) ??
    asArray(asRecord(raw)?.configOptions) ??
    asArray(asRecord(raw)?.config_options) ??
    []
  const out: AcpConfigOption[] = []
  for (const item of list) {
    const rec = asRecord(item)
    const id = asString(rec?.id)
    if (!id) continue
    const type = rec?.type === 'boolean' ? 'boolean' : 'select'
    const options: AcpConfigOptionValue[] = []
    for (const opt of asArray(rec?.options) ?? []) {
      const row = asRecord(opt)
      const value = asString(row?.value)
      if (!value) continue
      options.push({
        value,
        name: asString(row?.name) || value,
        description: asString(row?.description) ?? undefined
      })
    }
    const current =
      type === 'boolean'
        ? rec?.currentValue === true || rec?.current_value === true
        : (asString(rec?.currentValue) ?? asString(rec?.current_value) ?? options[0]?.value ?? '')
    out.push({
      id,
      name: asString(rec?.name) || id,
      description: asString(rec?.description) ?? undefined,
      category: asString(rec?.category) ?? undefined,
      type,
      currentValue: current,
      options: type === 'select' ? options : undefined
    })
  }
  return out
}

export function parseAcpSessionState(raw: unknown, previous?: AcpSessionState | null): AcpSessionState {
  const rec = asRecord(raw) ?? {}
  const modes = parseAcpSessionModes(rec.modes ?? rec.mode)
  const commands = parseAcpAvailableCommands(rec.availableCommands ?? rec.available_commands)
  const configOptions = parseAcpConfigOptions(rec.configOptions ?? rec.config_options)
  const title =
    asString(rec.title) ||
    asString(asRecord(rec.sessionInfo)?.title) ||
    asString(asRecord(rec.session_info)?.title) ||
    null
  const goal = parseAcpGoalSnapshot(
    rec.goal ?? asRecord(rec._meta)?.goal ?? asRecord(asRecord(rec.sessionInfo)?._meta)?.goal
  )
  return {
    currentModeId: modes.currentModeId ?? previous?.currentModeId ?? null,
    modes: modes.modes.length ? modes.modes : previous?.modes,
    commands: commands.length ? commands : previous?.commands,
    configOptions: configOptions.length ? configOptions : previous?.configOptions,
    sessionTitle: title ?? previous?.sessionTitle ?? null,
    thinkingLevels: previous?.thinkingLevels,
    goalCapability: previous?.goalCapability,
    goal: goal !== undefined ? goal : previous?.goal ?? null
  }
}

export function mergeAcpSessionState(
  previous: AcpSessionState | null | undefined,
  patch: Partial<AcpSessionState>
): AcpSessionState {
  return {
    currentModeId: patch.currentModeId !== undefined ? patch.currentModeId : previous?.currentModeId ?? null,
    modes: patch.modes ?? previous?.modes,
    commands: patch.commands ?? previous?.commands,
    configOptions: patch.configOptions ?? previous?.configOptions,
    sessionTitle: patch.sessionTitle !== undefined ? patch.sessionTitle : previous?.sessionTitle ?? null,
    thinkingLevels: patch.thinkingLevels ?? previous?.thinkingLevels,
    goalCapability:
      patch.goalCapability !== undefined ? patch.goalCapability : previous?.goalCapability ?? null,
    goal: patch.goal !== undefined ? patch.goal : previous?.goal ?? null
  }
}

export function acpModeConfigOption(state: AcpSessionState | null | undefined): AcpConfigOption | null {
  return state?.configOptions?.find((option) => option.category === 'mode' && option.type === 'select') ?? null
}

export function acpSessionModes(state: AcpSessionState | null | undefined): AcpSessionMode[] {
  const fromConfig = acpModeConfigOption(state)
  if (fromConfig?.options?.length) {
    return fromConfig.options.map((option) => ({
      id: option.value,
      name: option.name,
      description: option.description
    }))
  }
  return state?.modes ?? []
}

export function acpCurrentModeId(state: AcpSessionState | null | undefined): string | null {
  const fromConfig = acpModeConfigOption(state)
  if (fromConfig && typeof fromConfig.currentValue === 'string') return fromConfig.currentValue
  return state?.currentModeId ?? null
}

/** Persist a mode pick onto both `currentModeId` and a mode-category config option. */
export function patchAcpSessionMode(
  state: AcpSessionState | null | undefined,
  modeId: string
): AcpSessionState {
  const base = state ?? {}
  const config = acpModeConfigOption(base)
  const configOptions = config
    ? (base.configOptions ?? []).map((option) =>
        option.id === config.id ? { ...option, currentValue: modeId } : option
      )
    : base.configOptions
  return { ...base, currentModeId: modeId, configOptions }
}

/**
 * Persist `session/set_config_option`. Mode-category selects also update
 * `currentModeId` so the composer chip stays in sync without a live host.
 */
export function patchAcpConfigOption(
  state: AcpSessionState | null | undefined,
  id: string,
  value: string | boolean
): AcpSessionState | null {
  if (!state) return null
  const configOptions = (state.configOptions ?? []).map((option) =>
    option.id === id ? { ...option, currentValue: value } : option
  )
  const option = configOptions.find((row) => row.id === id)
  return {
    ...state,
    configOptions,
    currentModeId:
      option?.category === 'mode' && typeof value === 'string' ? value : state.currentModeId
  }
}

/** Visible ACP slash rows for the current draft, or null when the menu is closed. */
export function acpSlashMenuMatches(
  draft: string,
  commands: AcpAvailableCommand[]
): AcpAvailableCommand[] | null {
  const parsed = parseSlashDraft(draft)
  if (!parsed || commands.length === 0) return null
  if (parsed.rest.startsWith(' ') && commands.some((command) => command.name === parsed.name)) {
    return null
  }
  const matches = filterAcpCommands(commands, parsed.name).slice(0, 8)
  return matches.length ? matches : null
}

export function filterAcpCommands(commands: AcpAvailableCommand[], query: string): AcpAvailableCommand[] {
  const q = query.replace(/^\//, '').trim().toLowerCase()
  if (!q) return commands
  return commands.filter(
    (command) =>
      command.name.toLowerCase().startsWith(q) ||
      command.name.toLowerCase().includes(q) ||
      (command.description?.toLowerCase().includes(q) ?? false)
  )
}

export function parseSlashDraft(draft: string): { name: string; rest: string } | null {
  const match = draft.match(/^\/([^\s]*)(.*)$/)
  if (!match) return null
  return { name: match[1] ?? '', rest: match[2] ?? '' }
}

export type AcpFormField = {
  id: string
  title: string
  type: 'string' | 'number' | 'boolean' | 'integer'
  enum?: string[]
  default?: unknown
  required: boolean
}

export function parseAcpFormSchema(raw: unknown): AcpFormField[] {
  const rec = asRecord(raw)
  const properties = asRecord(rec?.properties)
  if (!properties) return []
  const required = new Set(
    (asArray(rec?.required) ?? []).filter((item): item is string => typeof item === 'string')
  )
  const fields: AcpFormField[] = []
  for (const [id, spec] of Object.entries(properties)) {
    const row = asRecord(spec) ?? {}
    const typeRaw = asString(row.type) ?? 'string'
    const type =
      typeRaw === 'number' || typeRaw === 'boolean' || typeRaw === 'integer' ? typeRaw : 'string'
    const enums = (asArray(row.enum) ?? [])
      .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : ''))
      .filter(Boolean)
    fields.push({
      id,
      title: asString(row.title) || asString(row.description) || id,
      type,
      enum: enums.length ? enums : undefined,
      default: row.default,
      required: required.has(id)
    })
  }
  return fields
}

/** Flatten a form schema into ask-card questions. */
export function acpFormToQuestions(fields: AcpFormField[]): {
  question: string
  choices?: string[]
  multiSelect?: boolean
}[] {
  return fields.map((field) => ({
    question: field.title,
    choices: field.enum,
    multiSelect: false
  }))
}

export function acpFormContentFromAnswers(
  fields: AcpFormField[],
  answers: Array<{ answer?: string; answers?: string[] }>
): Record<string, string | number | boolean> {
  const content: Record<string, string | number | boolean> = {}
  fields.forEach((field, index) => {
    const row = answers[index]
    const raw = row?.answer ?? row?.answers?.[0] ?? ''
    if (field.type === 'boolean') {
      content[field.id] = /^(true|1|yes|on)$/i.test(raw)
      return
    }
    if (field.type === 'number' || field.type === 'integer') {
      const n = Number(raw)
      if (Number.isFinite(n)) content[field.id] = field.type === 'integer' ? Math.trunc(n) : n
      return
    }
    if (raw) content[field.id] = raw
    else if (field.default != null && (typeof field.default === 'string' || typeof field.default === 'number' || typeof field.default === 'boolean')) {
      content[field.id] = field.default
    }
  })
  return content
}

export function fileUri(path: string): string {
  if (path.startsWith('file://')) return path
  return `file://${path}`
}

export function fileNameFromPath(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(slash + 1) : path
}

function isGoalAction(value: string): value is GoalAction {
  return value === 'set' || value === 'pause' || value === 'resume' || value === 'clear'
}

function parseGoalStatus(raw: unknown): GoalStatus | null {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (key === 'active' || key === 'running' || key === 'in_progress') return 'active'
  if (key === 'paused' || key === 'pause') return 'paused'
  if (key === 'blocked') return 'blocked'
  if (key === 'limited' || key === 'usagelimited' || key === 'budgetlimited') return 'limited'
  if (key === 'complete' || key === 'completed' || key === 'done' || key === 'finished') {
    return 'complete'
  }
  return null
}

function goalTimestamp(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  // Codex historically used seconds; ACP extension uses Unix ms.
  return raw > 0 && raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw)
}

function goalNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function uniqueGoalActions(actions: GoalAction[]): GoalAction[] {
  const seen = new Set<GoalAction>()
  const out: GoalAction[] = []
  for (const action of actions) {
    if (seen.has(action)) continue
    seen.add(action)
    out.push(action)
  }
  return out
}

export function commandsHaveGoal(commands: AcpAvailableCommand[] | undefined): boolean {
  return (commands ?? []).some((command) => command.name.toLowerCase() === 'goal')
}

export function parseAcpGoalCapability(raw: unknown): GoalCapability | null {
  const rec = asRecord(raw)
  if (!rec) return null
  if (asString(rec.objective) && !asArray(rec.actions) && !asString(rec.controlMethod)) {
    return null
  }
  const actions: GoalAction[] = []
  for (const item of asArray(rec.actions) ?? []) {
    const name = typeof item === 'string' ? item.trim().toLowerCase() : ''
    if (isGoalAction(name)) actions.push(name)
  }
  if (actions.length === 0) return null
  return {
    version: typeof rec.version === 'number' && Number.isFinite(rec.version) ? rec.version : 1,
    controlMethod: asString(rec.controlMethod) || asString(rec.control_method) || '_session/goal',
    actions,
    methodActions: [...actions]
  }
}

/**
 * `undefined` = field absent (keep current). `null` = explicit clear.
 */
export function parseAcpGoalSnapshot(raw: unknown): GoalSnapshot | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const rec = asRecord(raw)
  if (!rec) return undefined
  if (asArray(rec.actions) || asString(rec.controlMethod) || asString(rec.control_method)) {
    return undefined
  }
  const objective =
    asString(rec.objective) || asString(rec.condition) || asString(rec.title) || ''
  const status = parseGoalStatus(rec.status)
  if (!objective && !status) return undefined
  return {
    objective: objective || 'Goal',
    status: status ?? 'active',
    createdAt: goalTimestamp(rec.createdAt ?? rec.created_at ?? rec.setAt ?? rec.set_at),
    updatedAt: goalTimestamp(rec.updatedAt ?? rec.updated_at),
    iterations: goalNumber(rec.iterations),
    lastReason: asString(rec.lastReason) || asString(rec.last_reason) || undefined,
    tokenBudget:
      rec.tokenBudget === null || rec.token_budget === null
        ? null
        : goalNumber(rec.tokenBudget ?? rec.token_budget),
    tokensUsed: goalNumber(rec.tokensUsed ?? rec.tokens_used),
    timeUsedSeconds: goalNumber(rec.timeUsedSeconds ?? rec.time_used_seconds)
  }
}

export function readGoalSnapshotFromUpdate(update: Record<string, unknown>): GoalSnapshot | null | undefined {
  const meta = asRecord(update._meta)
  return parseAcpGoalSnapshot(update.goal ?? meta?.goal)
}

export function seedGoalCommands(
  kind: string,
  commands: AcpAvailableCommand[]
): AcpAvailableCommand[] {
  if (kind !== 'grok' || commandsHaveGoal(commands)) return commands
  return [GROK_GOAL_COMMAND, ...commands]
}

export function resolveGoalCapability(
  kind: string,
  advertised: GoalCapability | null,
  commands: AcpAvailableCommand[]
): GoalCapability | null {
  const slash = kind === 'grok' || commandsHaveGoal(commands)
  if (advertised) {
    const methodActions = advertised.methodActions ?? advertised.actions
    const actions = slash
      ? uniqueGoalActions([...advertised.actions, ...GOAL_ACTIONS])
      : advertised.actions
    return {
      version: advertised.version || 1,
      controlMethod: advertised.controlMethod || '_session/goal',
      actions,
      methodActions
    }
  }
  if (!slash) return null
  return {
    version: 1,
    controlMethod: 'slash',
    actions: [...GOAL_ACTIONS],
    methodActions: []
  }
}

export function goalUsesRpc(
  capability: GoalCapability | null | undefined,
  action: GoalAction
): boolean {
  if (!capability) return false
  const method = capability.controlMethod.trim()
  if (!method || method === 'slash') return false
  const rpc = capability.methodActions ?? capability.actions
  return rpc.includes(action)
}

export function goalSlashText(action: GoalAction, objective?: string): string {
  if (action === 'set') return `/goal ${objective?.trim() ?? ''}`.trim()
  return `/goal ${action}`
}

export function applyGoalSlash(
  current: GoalSnapshot | null | undefined,
  text: string
): GoalSnapshot | null | undefined {
  const parsed = parseSlashDraft(text.trim())
  if (!parsed || parsed.name.toLowerCase() !== 'goal') return undefined
  const rest = parsed.rest.trim()
  const [cmd] = rest.split(/\s+/)
  const key = (cmd ?? '').toLowerCase()
  if (!key || key === 'status') return undefined
  const now = Date.now()
  if (key === 'clear' && rest.toLowerCase() === 'clear') return null
  if (key === 'pause' && rest.toLowerCase() === 'pause') {
    if (!current) return { objective: 'Goal', status: 'paused', updatedAt: now }
    return { ...current, status: 'paused', updatedAt: now }
  }
  if (key === 'resume' && rest.toLowerCase() === 'resume') {
    if (!current) return { objective: 'Goal', status: 'active', updatedAt: now }
    return { ...current, status: 'active', updatedAt: now }
  }
  return {
    objective: rest,
    status: 'active',
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  }
}

export function optimisticGoal(
  current: GoalSnapshot | null | undefined,
  action: GoalAction,
  objective?: string
): GoalSnapshot | null | undefined {
  const now = Date.now()
  if (action === 'clear') return null
  if (action === 'set') {
    const text = objective?.trim()
    if (!text) return undefined
    return {
      objective: text,
      status: 'active',
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    }
  }
  if (action === 'pause') {
    if (!current) return { objective: 'Goal', status: 'paused', updatedAt: now }
    return { ...current, status: 'paused', updatedAt: now }
  }
  if (action === 'resume') {
    if (!current) return { objective: 'Goal', status: 'active', updatedAt: now }
    return { ...current, status: 'active', updatedAt: now }
  }
  return undefined
}

export function goalBannerActions(
  goal: GoalSnapshot,
  capability: GoalCapability | null | undefined
): GoalAction[] {
  const allowed = new Set(capability?.actions ?? ['clear'])
  const out: GoalAction[] = []
  if (goal.status === 'active' && allowed.has('pause')) out.push('pause')
  if (
    (goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'limited') &&
    allowed.has('resume')
  ) {
    out.push('resume')
  }
  if (allowed.has('clear')) out.push('clear')
  return out
}
