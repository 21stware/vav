/**
 * faaaaast — one-shot lookup. Deterministic local solves (math / units / encode)
 * stay on-device. Anything that needs a live number (weather, trains, flights,
 * FX) is searched — never fitted from a static table or model memory.
 */

export const FAAAAAST_KINDS = [
  'translate',
  'currency',
  'unit',
  'timezone',
  'math',
  'define',
  'date',
  'encode',
  'other'
] as const

export type FaaaaastKind = (typeof FAAAAAST_KINDS)[number]

export type FaaaaastTurn = {
  role: 'user' | 'assistant'
  text: string
}

export type FaaaaastResult = {
  kind: FaaaaastKind
  title: string
  answer: string
  note?: string
  /** IPA / phonetic hint when the answer is English. */
  ipa?: string
  local: boolean
}

export type FaaaaastDelta = {
  text: string
}

export type FaaaaastAskRequest = {
  text: string
  history?: FaaaaastTurn[]
}

export type FaaaaastAskOk = FaaaaastResult & { ok: true }
export type FaaaaastAskErr = { ok: false; error: 'no-key' | 'failed' | 'empty'; message?: string }
export type FaaaaastAskResult = FaaaaastAskOk | FaaaaastAskErr

export type FaaaaastInitPayload = {
  locale: 'zh-CN' | 'en'
  theme: 'light' | 'dark'
  displayCurrency: string
  /** Vendor / VAV mark shown in front of the input. */
  markId: string
  markName: string
}

export type FaaaaastSolveOptions = {
  locale?: 'zh-CN' | 'en'
  displayCurrency?: string
  now?: Date
}

const MAX_INPUT = 4000

const CURRENCY_CODES = new Set([
  'USD',
  'CNY',
  'EUR',
  'GBP',
  'JPY',
  'HKD',
  'TWD',
  'KRW',
  'SGD',
  'AUD',
  'CAD'
])

const CURRENCY_ALIAS: Record<string, string> = {
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  buck: 'USD',
  bucks: 'USD',
  美元: 'USD',
  美金: 'USD',
  '$': 'USD',
  cny: 'CNY',
  rmb: 'CNY',
  cnh: 'CNY',
  yuan: 'CNY',
  人民币: 'CNY',
  块: 'CNY',
  块钱: 'CNY',
  元: 'CNY',
  '\uFFE5': 'CNY',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  欧元: 'EUR',
  '€': 'EUR',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  sterling: 'GBP',
  英镑: 'GBP',
  '£': 'GBP',
  jpy: 'JPY',
  yen: 'JPY',
  日元: 'JPY',
  '¥': 'JPY',
  hkd: 'HKD',
  港币: 'HKD',
  港元: 'HKD',
  twd: 'TWD',
  ntd: 'TWD',
  新台币: 'TWD',
  台币: 'TWD',
  krw: 'KRW',
  won: 'KRW',
  韩元: 'KRW',
  韩币: 'KRW',
  '₩': 'KRW',
  sgd: 'SGD',
  新币: 'SGD',
  新加坡元: 'SGD',
  aud: 'AUD',
  澳元: 'AUD',
  cad: 'CAD',
  加元: 'CAD',
  加币: 'CAD'
}

type Dim = 'length' | 'mass' | 'temp' | 'data' | 'volume' | 'area'

type UnitDef = {
  dim: Dim
  /** Multiply to reach the dimension base. Ignored for temp. */
  toBase: number
  label: string
}

const UNITS: Record<string, UnitDef> = {
  mm: { dim: 'length', toBase: 0.001, label: 'mm' },
  cm: { dim: 'length', toBase: 0.01, label: 'cm' },
  m: { dim: 'length', toBase: 1, label: 'm' },
  meter: { dim: 'length', toBase: 1, label: 'm' },
  meters: { dim: 'length', toBase: 1, label: 'm' },
  km: { dim: 'length', toBase: 1000, label: 'km' },
  in: { dim: 'length', toBase: 0.0254, label: 'in' },
  inch: { dim: 'length', toBase: 0.0254, label: 'in' },
  inches: { dim: 'length', toBase: 0.0254, label: 'in' },
  ft: { dim: 'length', toBase: 0.3048, label: 'ft' },
  feet: { dim: 'length', toBase: 0.3048, label: 'ft' },
  foot: { dim: 'length', toBase: 0.3048, label: 'ft' },
  yd: { dim: 'length', toBase: 0.9144, label: 'yd' },
  yard: { dim: 'length', toBase: 0.9144, label: 'yd' },
  yards: { dim: 'length', toBase: 0.9144, label: 'yd' },
  mi: { dim: 'length', toBase: 1609.344, label: 'mi' },
  mile: { dim: 'length', toBase: 1609.344, label: 'mi' },
  miles: { dim: 'length', toBase: 1609.344, label: 'mi' },
  g: { dim: 'mass', toBase: 1, label: 'g' },
  gram: { dim: 'mass', toBase: 1, label: 'g' },
  grams: { dim: 'mass', toBase: 1, label: 'g' },
  kg: { dim: 'mass', toBase: 1000, label: 'kg' },
  lb: { dim: 'mass', toBase: 453.59237, label: 'lb' },
  lbs: { dim: 'mass', toBase: 453.59237, label: 'lb' },
  pound: { dim: 'mass', toBase: 453.59237, label: 'lb' },
  pounds: { dim: 'mass', toBase: 453.59237, label: 'lb' },
  oz: { dim: 'mass', toBase: 28.349523125, label: 'oz' },
  ounce: { dim: 'mass', toBase: 28.349523125, label: 'oz' },
  ounces: { dim: 'mass', toBase: 28.349523125, label: 'oz' },
  t: { dim: 'mass', toBase: 1_000_000, label: 't' },
  ton: { dim: 'mass', toBase: 1_000_000, label: 't' },
  tonnes: { dim: 'mass', toBase: 1_000_000, label: 't' },
  c: { dim: 'temp', toBase: 1, label: '°C' },
  f: { dim: 'temp', toBase: 1, label: '°F' },
  k: { dim: 'temp', toBase: 1, label: 'K' },
  celsius: { dim: 'temp', toBase: 1, label: '°C' },
  fahrenheit: { dim: 'temp', toBase: 1, label: '°F' },
  kelvin: { dim: 'temp', toBase: 1, label: 'K' },
  b: { dim: 'data', toBase: 1, label: 'B' },
  kb: { dim: 'data', toBase: 1000, label: 'KB' },
  mb: { dim: 'data', toBase: 1_000_000, label: 'MB' },
  gb: { dim: 'data', toBase: 1_000_000_000, label: 'GB' },
  tb: { dim: 'data', toBase: 1_000_000_000_000, label: 'TB' },
  kib: { dim: 'data', toBase: 1024, label: 'KiB' },
  mib: { dim: 'data', toBase: 1024 ** 2, label: 'MiB' },
  gib: { dim: 'data', toBase: 1024 ** 3, label: 'GiB' },
  ml: { dim: 'volume', toBase: 1, label: 'ml' },
  l: { dim: 'volume', toBase: 1000, label: 'L' },
  liter: { dim: 'volume', toBase: 1000, label: 'L' },
  litre: { dim: 'volume', toBase: 1000, label: 'L' },
  gal: { dim: 'volume', toBase: 3785.411784, label: 'gal' },
  gallon: { dim: 'volume', toBase: 3785.411784, label: 'gal' },
  gallons: { dim: 'volume', toBase: 3785.411784, label: 'gal' },
  m2: { dim: 'area', toBase: 1, label: 'm²' },
  sqm: { dim: 'area', toBase: 1, label: 'm²' },
  km2: { dim: 'area', toBase: 1_000_000, label: 'km²' },
  sqft: { dim: 'area', toBase: 0.09290304, label: 'ft²' },
  'ft2': { dim: 'area', toBase: 0.09290304, label: 'ft²' }
}

const UNIT_DEFAULT_TARGET: Record<string, string> = {
  mm: 'in',
  cm: 'in',
  m: 'ft',
  meter: 'ft',
  meters: 'ft',
  km: 'mi',
  in: 'cm',
  inch: 'cm',
  inches: 'cm',
  ft: 'm',
  feet: 'm',
  foot: 'm',
  yd: 'm',
  yard: 'm',
  yards: 'm',
  mi: 'km',
  mile: 'km',
  miles: 'km',
  g: 'oz',
  gram: 'oz',
  grams: 'oz',
  kg: 'lb',
  lb: 'kg',
  lbs: 'kg',
  pound: 'kg',
  pounds: 'kg',
  oz: 'g',
  ounce: 'g',
  ounces: 'g',
  t: 'lb',
  ton: 'lb',
  tonnes: 'lb',
  c: 'f',
  f: 'c',
  k: 'c',
  celsius: 'f',
  fahrenheit: 'c',
  kelvin: 'c',
  b: 'kb',
  kb: 'mb',
  mb: 'gb',
  gb: 'mb',
  tb: 'gb',
  kib: 'kb',
  mib: 'mb',
  gib: 'gb',
  ml: 'l',
  l: 'gal',
  liter: 'gal',
  litre: 'gal',
  gal: 'l',
  gallon: 'l',
  gallons: 'l',
  m2: 'sqft',
  sqm: 'sqft',
  km2: 'sqft',
  sqft: 'm2',
  ft2: 'm2'
}

const KIND_SET = new Set<string>(FAAAAAST_KINDS)

export function isFaaaaastKind(value: unknown): value is FaaaaastKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

export function normalizeFaaaaastInput(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').trim()
}

export function formatFaaaaastNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6
  const rounded = Number(value.toPrecision(abs >= 1 ? 7 : 6))
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  }).format(rounded)
}

export function resolveCurrencyCode(token: string): string | null {
  const raw = token.trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (CURRENCY_CODES.has(upper)) return upper
  return CURRENCY_ALIAS[raw.toLowerCase()] ?? CURRENCY_ALIAS[raw] ?? null
}

function parseAmountToken(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '')
  if (!text) return null
  const wan = text.match(/^(-?[\d.]+)\s*万$/)
  if (wan) {
    const n = Number(wan[1])
    return Number.isFinite(n) ? n * 10_000 : null
  }
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

const CURRENCY_TOKENS = [...new Set([...CURRENCY_CODES, ...Object.keys(CURRENCY_ALIAS)])].sort(
  (a, b) => b.length - a.length
)

/** Scan left-to-right, longest alias first: `10000美元现在RMB` → USD, CNY. */
function findCurrencyCodes(input: string): string[] {
  const codes: string[] = []
  let i = 0
  while (i < input.length) {
    let hit: { code: string; length: number } | null = null
    for (const token of CURRENCY_TOKENS) {
      const slice = input.slice(i, i + token.length)
      if (slice !== token && slice.toLowerCase() !== token.toLowerCase()) continue
      const code = resolveCurrencyCode(slice)
      if (!code) continue
      hit = { code, length: token.length }
      break
    }
    if (hit) {
      codes.push(hit.code)
      i += hit.length
    } else {
      i += 1
    }
  }
  return codes
}

function tempToCelsius(value: number, unit: string): number | null {
  const key = unit.toLowerCase()
  if (key === 'c' || key === 'celsius') return value
  if (key === 'f' || key === 'fahrenheit') return ((value - 32) * 5) / 9
  if (key === 'k' || key === 'kelvin') return value - 273.15
  return null
}

function celsiusToTemp(celsius: number, unit: string): number | null {
  const key = unit.toLowerCase()
  if (key === 'c' || key === 'celsius') return celsius
  if (key === 'f' || key === 'fahrenheit') return (celsius * 9) / 5 + 32
  if (key === 'k' || key === 'kelvin') return celsius + 273.15
  return null
}

function convertUnit(amount: number, fromKey: string, toKey: string): number | null {
  const from = UNITS[fromKey]
  const to = UNITS[toKey]
  if (!from || !to || from.dim !== to.dim) return null
  if (from.dim === 'temp') {
    const c = tempToCelsius(amount, fromKey)
    if (c == null) return null
    return celsiusToTemp(c, toKey)
  }
  return (amount * from.toBase) / to.toBase
}

function tryUnit(input: string, locale: 'zh-CN' | 'en'): FaaaaastResult | null {
  const compact = input.replace(/°/g, '').replace(/\s+/g, ' ').trim()
  const pair = compact.match(
    /^([+-]?[\d,.]+)\s*([A-Za-z0-9²³]{1,10})\s*(?:to|in|into|=|→|->|换|成|到)\s*([A-Za-z0-9²³]{1,10})$/i
  )
  const single = compact.match(/^([+-]?[\d,.]+)\s*([A-Za-z0-9²³]{1,10})$/)
  const match = pair ?? single
  if (!match) return null
  const amount = parseAmountToken(match[1]!)
  const fromKey = match[2]!.toLowerCase()
  if (amount == null || !UNITS[fromKey]) return null
  const toKey = (pair ? match[3]!.toLowerCase() : UNIT_DEFAULT_TARGET[fromKey]) ?? ''
  if (!UNITS[toKey]) return null
  const converted = convertUnit(amount, fromKey, toKey)
  if (converted == null) return null
  const fromLabel = UNITS[fromKey]!.label
  const toLabel = UNITS[toKey]!.label
  return {
    kind: 'unit',
    title: locale === 'zh-CN' ? '单位' : 'Units',
    answer: `${formatFaaaaastNumber(amount)} ${fromLabel} → ${formatFaaaaastNumber(converted)} ${toLabel}`,
    local: true
  }
}

function tryMath(input: string, locale: 'zh-CN' | 'en'): FaaaaastResult | null {
  const expr = input
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\^/g, '**')
    .replace(/\s+/g, '')
  if (expr.length < 3) return null
  if (!/[\d)][*+\-/%]/.test(expr) && !expr.includes('**')) return null
  if (!/^[\d+*/%().-]+$/.test(expr.replace(/\*\*/g, ''))) return null
  if (!/[\d.]/.test(expr)) return null
  try {
    const value = Function(`"use strict"; return (${expr})`)() as unknown
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return {
      kind: 'math',
      title: locale === 'zh-CN' ? '计算' : 'Math',
      answer: formatFaaaaastNumber(value),
      local: true
    }
  } catch {
    return null
  }
}

function looksLikeBase64(text: string): boolean {
  if (text.length < 8 || text.length % 4 !== 0) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false
  if (/^[A-Za-z]+$/.test(text) && text.length < 16) return false
  return true
}

function utf8FromBase64(text: string): string | null {
  try {
    const decoded =
      typeof atob === 'function'
        ? atob(text)
        : Buffer.from(text, 'base64').toString('binary')
    const bytes = Uint8Array.from(decoded, (ch) => ch.charCodeAt(0))
    const out = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!out || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(out)) return null
    return out
  } catch {
    return null
  }
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64')
}

function tryEncode(input: string, locale: 'zh-CN' | 'en'): FaaaaastResult | null {
  const title = locale === 'zh-CN' ? '编解码' : 'Encode'
  const base64Cmd = input.match(/^(?:base64|b64)\s+(encode|decode)\s+(.+)$/i)
  if (base64Cmd) {
    const mode = base64Cmd[1]!.toLowerCase()
    const body = base64Cmd[2]!.trim()
    if (mode === 'decode') {
      const out = utf8FromBase64(body.replace(/\s+/g, ''))
      if (!out) return null
      return { kind: 'encode', title, answer: out, local: true }
    }
    return { kind: 'encode', title, answer: utf8ToBase64(body), local: true }
  }
  const base64Bare = input.match(/^(?:base64|b64)\s+(.+)$/i)
  if (base64Bare) {
    return { kind: 'encode', title, answer: utf8ToBase64(base64Bare[1]!.trim()), local: true }
  }
  const urlEnc = input.match(/^url(?:en)?code\s+(.+)$/i)
  if (urlEnc) {
    return { kind: 'encode', title, answer: encodeURIComponent(urlEnc[1]!), local: true }
  }
  const urlDec = input.match(/^urldecode\s+(.+)$/i)
  if (urlDec) {
    try {
      return { kind: 'encode', title, answer: decodeURIComponent(urlDec[1]!), local: true }
    } catch {
      return null
    }
  }
  if (looksLikeBase64(input)) {
    const out = utf8FromBase64(input)
    if (out) return { kind: 'encode', title, answer: out, local: true }
  }
  return null
}

/**
 * Instant answers that do not need a model or the network.
 * Currency / weather / travel stay out — those need a live search.
 */
export function solveFaaaaastLocal(
  raw: string,
  opts: FaaaaastSolveOptions = {}
): FaaaaastResult | null {
  const input = normalizeFaaaaastInput(raw)
  if (!input || input.length > MAX_INPUT) return null
  const locale = opts.locale === 'en' ? 'en' : 'zh-CN'
  return tryEncode(input, locale) ?? tryUnit(input, locale) ?? tryMath(input, locale)
}

const LIVE_SEARCH_RE =
  /天气|气温|温度|降雨|下雨|台风|雾霾|空气质量|预报|霾|紫外线|高铁|火车|动车|车次|车票|列车|12306|航班|机票|飞机票|航线|起飞|降落|余票|汇率|牌价|外汇|换汇|股价|行情|指数|比特币|金价|油价|票价|新闻|比分|赛果|实时|weather|forecast|rainfall|typhoon|aqi|train|railway|gaotie|flight|airfare|airline|ticket|exchange\s*rate|forex|spot\s*rate|stock|nasdaq|bitcoin|btc|gold\s*price|oil\s*price|score|kickoff/i

const LIVE_WHEN_RE = /今天|今日|今晚|明天|明日|后天|now|today|tonight|tomorrow|tonight/i

export function faaaaastNeedsLiveSearch(raw: string): boolean {
  const input = normalizeFaaaaastInput(raw)
  if (!input) return false
  if (LIVE_SEARCH_RE.test(input)) return true
  if (
    LIVE_WHEN_RE.test(input) &&
    /到|至|去|→|->|(?:^|[\s,，])(?:from|to)(?:$|[\s,，])/i.test(input)
  ) {
    return true
  }
  const codes = findCurrencyCodes(input)
  if (codes.length >= 2) return true
  if (codes.length >= 1 && /[+-]?[\d,.]+|汇率|牌价|兑换|换算|rate|forex|\bfx\b/i.test(input)) {
    return true
  }
  return false
}

/** Closed-world language work — skip the web. Live facts never take this path. */
export function faaaaastIsTranslateOnly(raw: string): boolean {
  const input = normalizeFaaaaastInput(raw)
  if (!input) return false
  if (faaaaastNeedsLiveSearch(input)) return false
  if (/翻译|译成|translate\b|英文怎么说|中文怎么说/i.test(input)) return true
  if (/\d/.test(input)) return false
  if (/[?？]|多少|几点|什么|哪个|where|what|who|why|how|when/i.test(input)) return false
  return true
}

/** Search unless the line is a local solve or a closed-world translation. */
export function faaaaastShouldSearch(raw: string): boolean {
  if (faaaaastNeedsLiveSearch(raw)) return true
  return !faaaaastIsTranslateOnly(raw)
}

export function formatFaaaaastClock(now: Date, locale: 'zh-CN' | 'en'): string {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const weekday = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    weekday: 'long'
  }).format(now)
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now)
  return `${ymd} ${weekday} ${time}`
}

export function faaaaastLiveSearchQuery(
  raw: string,
  opts: FaaaaastSolveOptions = {}
): string {
  const input = normalizeFaaaaastInput(raw)
  const now = opts.now ?? new Date()
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const codes = findCurrencyCodes(input)
  if (codes.length > 0) {
    const from = codes[0]!
    const to = codes[1] && codes[1] !== from ? codes[1] : from === 'USD' ? 'CNY' : 'USD'
    return `${input} ${from} ${to} 汇率 exchange rate today ${ymd}`
  }
  if (/天气|气温|预报|weather|forecast/i.test(input)) {
    return `${input} 天气预报 weather forecast ${ymd}`
  }
  return `${input} ${ymd}`
}

export function parseFaaaaastModelText(raw: string): FaaaaastResult {
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
      const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
      if (answer) {
        return {
          kind: isFaaaaastKind(parsed.kind) ? parsed.kind : 'other',
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '',
          answer,
          note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : undefined,
          ipa: typeof parsed.ipa === 'string' && parsed.ipa.trim() ? parsed.ipa.trim() : undefined,
          local: false
        }
      }
    } catch {
      // fall through
    }
  }
  return { kind: 'other', title: '', answer: text, local: false }
}

export function faaaaastLooksLikeEnglish(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return latin >= 3 && latin > cjk * 2
}

/** Visible answer while JSON is still streaming. */
export function extractFaaaaastStreamText(raw: string): string {
  const parsed = parseFaaaaastModelText(raw)
  if (parsed.answer && parsed.answer !== raw.trim()) return parsed.answer
  const partial = raw.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (partial) {
    try {
      return JSON.parse(`"${partial[1]!}"`) as string
    } catch {
      return partial[1]!.replace(/\\n/g, '\n').replace(/\\"/g, '"')
    }
  }
  if (/^\s*[{`]/.test(raw)) return ''
  return raw
}

export function buildFaaaaastSystemPrompt(opts: {
  locale: 'zh-CN' | 'en'
  displayCurrency: string
  now?: Date
}): string {
  const locale = opts.locale === 'en' ? 'en' : 'zh-CN'
  const currency = resolveCurrencyCode(opts.displayCurrency) ?? 'USD'
  const clock = formatFaaaaastClock(opts.now ?? new Date(), locale)
  return [
    'You are the VAV agent in faaaaast glance mode — same tools and judgement, shorter answers.',
    'You have web_search and web_fetch. Use them. Do not say you lack a weather, train, flight, or FX tool.',
    `Local clock: ${clock}. Prefer ${currency} when a currency target is omitted.`,
    'Rules:',
    '- Live facts (weather, trains, flights, FX, prices, scores, “today/tomorrow”) must be looked up this turn with web_search, then web_fetch on a promising result.',
    '- Follow-ups like “上海呢” / “and Shanghai?” are a new lookup. Search that subject again. Do not reuse another city’s numbers.',
    '- Never invent or estimate a number. If a page has no figure, fetch another or say the source had none.',
    '- Translate, define, math, and units can be answered directly when no live number is required.',
    '- Keep the reply glanceable: a few lines, copyable, no tool narration, no hidden reasoning in the answer.',
    '- When the answer itself is English, set `ipa` to IPA pronunciation of that English (not a translation of it).',
    'Reply with JSON only, no markdown:',
    '{"kind":"translate","title":"short label","answer":"copyable result","ipa":"/ˈhɛloʊ/","note":"optional source"}',
    `Kinds: translate | currency | unit | timezone | math | define | date | encode | other`,
    `UI locale: ${locale}. Write title/note in that locale. The answer itself stays in the language the user needs.`
  ].join('\n')
}

export function faaaaastUserPrompt(
  text: string,
  history: FaaaaastTurn[] = [],
  evidence?: string
): string {
  const body =
    history.length === 0
      ? text
      : `${history
          .slice(-6)
          .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
          .join('\n')}\nUser: ${text}`
  const clipped = evidence?.trim()
  if (!clipped) return body
  return `LIVE WEB EVIDENCE — use only this for numbers and schedules:\n\n${clipped}\n\nUSER QUERY:\n${body}`
}
