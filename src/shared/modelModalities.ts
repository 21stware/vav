import type { ModelModality, ModelOption } from './types.ts'

const ORDER: readonly ModelModality[] = ['text', 'image', 'audio']

export function normalizeModalities(raw: unknown): ModelModality[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<ModelModality>()
  for (const item of raw) {
    const token = modalityToken(item)
    if (token) seen.add(token)
  }
  return ORDER.filter((m) => seen.has(m))
}

function modalityToken(value: unknown): ModelModality | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'text') return 'text'
  if (v === 'image' || v === 'vision' || v === 'photo') return 'image'
  if (v === 'audio' || v === 'speech' || v === 'voice') return 'audio'
  return null
}

function splitModalityList(raw: string): ModelModality[] {
  return normalizeModalities(raw.split(/[+/,|&]+/))
}

/** OpenRouter-style `text+image->text`. */
export function parseModalityArrow(raw: string): {
  input: ModelModality[]
  output: ModelModality[]
} | null {
  const parts = raw.split(/\s*(?:->|→)\s*/)
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const input = splitModalityList(parts[0])
  const output = splitModalityList(parts[1])
  if (input.length === 0 && output.length === 0) return null
  return { input, output }
}

function readArrow(rec: Record<string, unknown>): {
  input: ModelModality[]
  output: ModelModality[]
} | null {
  for (const key of ['modality', 'architecture'] as const) {
    const value = rec[key]
    if (typeof value === 'string') {
      const parsed = parseModalityArrow(value)
      if (parsed) return parsed
    }
  }
  const architecture = rec.architecture
  if (architecture && typeof architecture === 'object' && !Array.isArray(architecture)) {
    const inner = architecture as Record<string, unknown>
    if (typeof inner.modality === 'string') {
      const parsed = parseModalityArrow(inner.modality)
      if (parsed) return parsed
    }
  }
  return null
}

function readList(rec: Record<string, unknown>, keys: string[]): ModelModality[] {
  for (const key of keys) {
    const hit = normalizeModalities(rec[key])
    if (hit.length > 0) return hit
  }
  const architecture = rec.architecture
  if (architecture && typeof architecture === 'object' && !Array.isArray(architecture)) {
    const inner = architecture as Record<string, unknown>
    for (const key of keys) {
      const hit = normalizeModalities(inner[key])
      if (hit.length > 0) return hit
    }
  }
  return []
}

/** Pull input/output channels off a `/models` row when the provider published any. */
export function parseLiveModalities(row: Record<string, unknown>): {
  input?: ModelModality[]
  output?: ModelModality[]
} {
  const input = readList(row, ['input_modalities', 'input', 'supported_input_modalities'])
  const output = readList(row, ['output_modalities', 'output', 'supported_output_modalities'])
  if (input.length > 0 || output.length > 0) {
    return {
      ...(input.length > 0 ? { input } : {}),
      ...(output.length > 0 ? { output } : {})
    }
  }
  const arrow = readArrow(row)
  if (!arrow) return {}
  return {
    ...(arrow.input.length > 0 ? { input: arrow.input } : {}),
    ...(arrow.output.length > 0 ? { output: arrow.output } : {})
  }
}

/**
 * When `/models` and the catalog are silent, read the id. DeepSeek V4 Flash /
 * Pro stay text-only; `vision` (and similar) mark image input.
 */
export function inferModalitiesFromId(modelId: string): {
  input: ModelModality[]
  output: ModelModality[]
} {
  const id = modelId.trim().toLowerCase()
  const input = new Set<ModelModality>(['text'])
  const output = new Set<ModelModality>(['text'])
  if (!id) return { input: ['text'], output: ['text'] }

  if (
    /vision|\bvlm\b|-vl-|_vl_|-vl$|\bvl\b/.test(id) ||
    /gpt-4o|gpt-4\.1|gpt-5|claude|gemini|grok/.test(id)
  ) {
    // Official DeepSeek chat ids are text-only unless the id says vision.
    if (!/^deepseek/.test(id) || /vision/.test(id)) input.add('image')
  }
  if (/whisper|transcri|speech-to-text|realtime|gpt-4o-audio/.test(id)) input.add('audio')
  if (/\btts\b|text-to-speech|speech|realtime|gpt-4o-audio/.test(id) && !/whisper|transcri/.test(id)) {
    output.add('audio')
  }
  if (/dall-e|imagen|gpt-image|image-gen|flux/.test(id)) output.add('image')

  return {
    input: ORDER.filter((m) => input.has(m)),
    output: ORDER.filter((m) => output.has(m))
  }
}

export function resolveModelModalities(
  model: Pick<ModelOption, 'id' | 'input' | 'output'>,
  catalogInput?: readonly ('text' | 'image')[] | null
): { input: ModelModality[]; output: ModelModality[] } {
  const liveIn = normalizeModalities(model.input)
  const liveOut = normalizeModalities(model.output)
  if (liveIn.length > 0 || liveOut.length > 0) {
    return {
      input: liveIn.length > 0 ? liveIn : ['text'],
      output: liveOut.length > 0 ? liveOut : ['text']
    }
  }
  const catalog = normalizeModalities(catalogInput ? [...catalogInput] : [])
  if (catalog.length > 0) return { input: catalog, output: ['text'] }
  return inferModalitiesFromId(model.id)
}
