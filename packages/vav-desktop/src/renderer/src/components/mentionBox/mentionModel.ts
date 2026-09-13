/**
 * Pure mention-text model — no DOM, no React.
 *
 * This is the correctness core of the mention box. It owns the two families of
 * bugs that make @-mention inputs fragile:
 *
 *   1. "pretext" detection — deciding, from `(value, caret)` alone, whether the
 *      caret is currently editing a mention and what the query is. Named after
 *      the old autocomplete term for "the text before the caret".
 *   2. full-span replacement — when a candidate is picked the caret can sit
 *      *mid-token*, so we must replace the whole token's extent, not just the
 *      pretext up to the caret. Replacing only the pretext is exactly the
 *      Mattermost MM-57320 "erase everything after the caret" bug.
 *
 * Plus atomic caret / delete so a committed `@name` behaves like one unit even
 * though it lives in a plain string.
 *
 * Kept free of renderer imports so it runs under `node --test`.
 */

export type Mention = {
  /** Index of the trigger char in the source string. */
  start: number
  /** Exclusive end index (trigger + name). */
  end: number
  /** The trigger character, e.g. `@`. */
  trigger: string
  /** The mention name (without the trigger). */
  name: string
}

export type ActiveMention = {
  /** Index of the trigger char that opened the active query. */
  start: number
  /** The trigger character. */
  trigger: string
  /** Text between the trigger and the caret — the live search query. */
  query: string
}

export type MentionOptions = {
  /** Trigger characters. Default `['@']`. */
  triggers?: string[]
  /**
   * Is `ch` allowed inside a mention name? Default: any non-whitespace char
   * that is not itself a trigger. Whitespace always ends a name.
   */
  isNameChar?: (ch: string) => boolean
  /**
   * Given the greedy run of name chars after a trigger, return the accepted
   * name (possibly a shorter prefix) or `null` to reject the run entirely.
   * Use this to match against a known roster. Default accepts the whole run
   * when non-empty.
   */
  matchName?: (run: string) => string | null
}

const DEFAULT_TRIGGERS = ['@']

/**
 * Default name-char class: letters, numbers, and the path-ish glue
 * `_ . / \ + -`. Deliberately excludes sentence punctuation (`! ? , ; :` …) and
 * brackets so `@maya!` yields `maya`, while still covering `@src/app.ts`.
 */
const DEFAULT_NAME_CHAR = /[\p{L}\p{N}_./\\+-]/u

/** Chars allowed immediately before a trigger for it to open a mention. */
const OPEN_BOUNDARY = /[\s([{<"'`]/

function triggersOf(options?: MentionOptions): string[] {
  return options?.triggers ?? DEFAULT_TRIGGERS
}

function nameCharFn(options: MentionOptions | undefined, triggers: string[]): (ch: string) => boolean {
  if (options?.isNameChar) return options.isNameChar
  return (ch) => DEFAULT_NAME_CHAR.test(ch) && !triggers.includes(ch)
}

function matchNameFn(options?: MentionOptions): (run: string) => string | null {
  return options?.matchName ?? ((run) => (run.length > 0 ? run : null))
}

/** A trigger opens a mention only at the start of the text or after whitespace
 *  / an opening bracket / quote. This stops `email@host` becoming a mention. */
function boundaryOk(text: string, triggerIndex: number): boolean {
  if (triggerIndex === 0) return true
  return OPEN_BOUNDARY.test(text[triggerIndex - 1] ?? '')
}

/** Greedy end of the name run starting just after `triggerIndex`. */
function nameRunEnd(
  text: string,
  triggerIndex: number,
  isNameChar: (ch: string) => boolean
): number {
  let j = triggerIndex + 1
  while (j < text.length && isNameChar(text[j] as string)) j++
  return j
}

/**
 * Exclusive end index of the whole mention token that starts at `start`
 * (a trigger index), i.e. trigger + full greedy name run. Independent of the
 * caret — this is what replacement must overwrite so a mid-token caret does not
 * leave a dangling tail.
 */
export function mentionSpanEnd(text: string, start: number, options?: MentionOptions): number {
  const triggers = triggersOf(options)
  const isNameChar = nameCharFn(options, triggers)
  return nameRunEnd(text, start, isNameChar)
}

/**
 * Scan the whole string for committed mentions. `matchName` lets a roster
 * shorten the greedy run (e.g. `@mayaXY` → `@maya`) or reject it.
 */
export function findMentions(text: string, options?: MentionOptions): Mention[] {
  const triggers = triggersOf(options)
  const isNameChar = nameCharFn(options, triggers)
  const matchName = matchNameFn(options)
  const out: Mention[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (triggers.includes(ch) && boundaryOk(text, i)) {
      const runEnd = nameRunEnd(text, i, isNameChar)
      const run = text.slice(i + 1, runEnd)
      const name = matchName(run)
      if (name && name.length > 0 && run.startsWith(name)) {
        out.push({ start: i, end: i + 1 + name.length, trigger: ch, name })
        i = i + 1 + name.length
        continue
      }
    }
    i++
  }
  return out
}

/**
 * The "pretext" query: is the caret currently typing a mention? Walk left from
 * the caret over name chars; if we land on a trigger at a valid boundary,
 * everything from the trigger to the caret is the live query.
 *
 * Returns `null` when the caret is not inside an open mention (e.g. there is a
 * space between the trigger and the caret, or no trigger to the left).
 */
export function getActiveMention(
  text: string,
  caret: number,
  options?: MentionOptions
): ActiveMention | null {
  const triggers = triggersOf(options)
  const isNameChar = nameCharFn(options, triggers)
  if (caret < 0 || caret > text.length) return null
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i] as string
    if (triggers.includes(ch)) {
      if (!boundaryOk(text, i)) return null
      return { start: i, trigger: ch, query: text.slice(i + 1, caret) }
    }
    if (!isNameChar(ch)) return null
    i--
  }
  return null
}

/**
 * Replace the mention token that starts at `activeStart` with `insert`,
 * overwriting the token's *full* extent (not just up to the caret). Returns the
 * new value and the caret position after the inserted text.
 */
export function applyMention(
  text: string,
  activeStart: number,
  insert: string,
  options?: MentionOptions
): { value: string; caret: number } {
  const end = mentionSpanEnd(text, activeStart, options)
  const before = text.slice(0, activeStart)
  const after = text.slice(end)
  return { value: before + insert + after, caret: before.length + insert.length }
}

/** Split the text into ordered runs for rendering (plain text vs. mention). */
export type Segment =
  | { kind: 'text'; start: number; end: number; text: string }
  | { kind: 'mention'; start: number; end: number; text: string; name: string }

export function segmentText(text: string, mentions: Mention[]): Segment[] {
  const sorted = [...mentions].sort((a, b) => a.start - b.start)
  const out: Segment[] = []
  let cursor = 0
  for (const m of sorted) {
    if (m.start < cursor) continue // defensive: skip overlaps
    if (m.start > cursor) {
      out.push({ kind: 'text', start: cursor, end: m.start, text: text.slice(cursor, m.start) })
    }
    out.push({ kind: 'mention', start: m.start, end: m.end, text: text.slice(m.start, m.end), name: m.name })
    cursor = m.end
  }
  if (cursor < text.length) {
    out.push({ kind: 'text', start: cursor, end: text.length, text: text.slice(cursor) })
  }
  return out
}

/** Mention strictly containing `caret` (caret between its edges), else null. */
export function mentionContaining(mentions: Mention[], caret: number): Mention | null {
  return mentions.find((m) => m.start < caret && caret < m.end) ?? null
}

/**
 * Atomic Backspace: if the collapsed caret sits at a mention's right edge or
 * inside it, return the range to delete (the whole mention). Otherwise `null`
 * for default behavior. Ranged selections are left to the browser.
 */
export function atomicBackspace(
  selStart: number,
  selEnd: number,
  mentions: Mention[]
): { start: number; end: number } | null {
  if (selStart !== selEnd) return null
  const caret = selStart
  const m = mentions.find((x) => x.end === caret || (x.start < caret && caret < x.end))
  return m ? { start: m.start, end: m.end } : null
}

/** Atomic Delete (forward): caret at a mention's left edge or inside it. */
export function atomicDelete(
  selStart: number,
  selEnd: number,
  mentions: Mention[]
): { start: number; end: number } | null {
  if (selStart !== selEnd) return null
  const caret = selStart
  const m = mentions.find((x) => x.start === caret || (x.start < caret && caret < x.end))
  return m ? { start: m.start, end: m.end } : null
}

/**
 * Atomic caret movement: when a horizontal arrow would step *into* a mention,
 * jump to its far edge instead so the caret never rests inside a mention.
 * Returns the target caret or `null` to fall back to native movement.
 */
export function atomicCaretTarget(
  caret: number,
  direction: 'left' | 'right',
  mentions: Mention[]
): number | null {
  if (direction === 'left') {
    const m = mentions.find((x) => x.start < caret && caret <= x.end)
    return m ? m.start : null
  }
  const m = mentions.find((x) => x.start <= caret && caret < x.end)
  return m ? m.end : null
}
