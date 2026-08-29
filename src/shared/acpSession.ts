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

export interface AcpSessionState {
  currentModeId?: string | null
  modes?: AcpSessionMode[]
  commands?: AcpAvailableCommand[]
  configOptions?: AcpConfigOption[]
  sessionTitle?: string | null
  /** Cursor thinking levels this model actually accepts. */
  thinkingLevels?: Array<'off' | 'low' | 'medium' | 'high' | 'max'>
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
  return {
    currentModeId: modes.currentModeId ?? previous?.currentModeId ?? null,
    modes: modes.modes.length ? modes.modes : previous?.modes,
    commands: commands.length ? commands : previous?.commands,
    configOptions: configOptions.length ? configOptions : previous?.configOptions,
    sessionTitle: title ?? previous?.sessionTitle ?? null,
    thinkingLevels: previous?.thinkingLevels
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
    thinkingLevels: patch.thinkingLevels ?? previous?.thinkingLevels
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
