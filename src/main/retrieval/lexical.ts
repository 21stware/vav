/**
 * Lightweight CJK+Latin tokenizer and BM25 for in-process document search.
 * No native deps — good enough for small-scale local RAG.
 */

const CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u

export function tokenize(text: string): string[] {
  const out: string[] = []
  const s = text.normalize('NFKC')
  // Split into CJK runs and non-CJK runs.
  const parts = s.split(/(\s+)/)
  for (const part of parts) {
    if (!part || /^\s+$/.test(part)) continue
    let i = 0
    while (i < part.length) {
      const ch = part[i]!
      if (CJK.test(ch)) {
        let j = i
        while (j < part.length && CJK.test(part[j]!)) j++
        const run = part.slice(i, j)
        if (run.length === 1) out.push(run)
        else {
          for (let k = 0; k < run.length - 1; k++) out.push(run.slice(k, k + 2))
          // Also keep unigrams for rare single-char queries.
          for (const c of run) out.push(c)
        }
        i = j
      } else {
        let j = i
        while (j < part.length && !CJK.test(part[j]!)) j++
        const run = part.slice(i, j).toLowerCase()
        for (const tok of run.split(/[^a-z0-9_+.-]+/i)) {
          if (tok.length >= 2) out.push(tok)
          else if (tok.length === 1 && /[0-9]/.test(tok)) out.push(tok)
        }
        i = j
      }
    }
  }
  return out
}

export interface Bm25State {
  /** Document frequency per term. */
  df: Map<string, number>
  /** Tokenized docs: term → tf */
  docs: Array<Map<string, number>>
  avgdl: number
  N: number
}

export function buildBm25(texts: string[]): Bm25State {
  const docs: Array<Map<string, number>> = []
  const df = new Map<string, number>()
  let totalLen = 0
  for (const text of texts) {
    const tokens = tokenize(text)
    totalLen += tokens.length
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    docs.push(tf)
    const seen = new Set(tf.keys())
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const N = docs.length || 1
  return { df, docs, avgdl: totalLen / N || 1, N }
}

/** Okapi BM25 score for one document. */
export function bm25Score(
  state: Bm25State,
  docIndex: number,
  queryTokens: string[],
  k1 = 1.2,
  b = 0.75
): number {
  const tf = state.docs[docIndex]
  if (!tf || queryTokens.length === 0) return 0
  let dl = 0
  for (const v of tf.values()) dl += v
  let score = 0
  const seen = new Set<string>()
  for (const term of queryTokens) {
    if (seen.has(term)) continue
    seen.add(term)
    const f = tf.get(term) ?? 0
    if (f === 0) continue
    const n = state.df.get(term) ?? 0
    const idf = Math.log(1 + (state.N - n + 0.5) / (n + 0.5))
    const denom = f + k1 * (1 - b + b * (dl / state.avgdl))
    score += idf * ((f * (k1 + 1)) / denom)
  }
  return score
}

/** Token overlap (Jaccard-ish) between two strings. */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function phraseBoost(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return 0
  const hay = text.toLowerCase()
  if (hay.includes(q)) return 1
  // Loose: all query tokens appear in order
  const tokens = tokenize(query)
  if (tokens.length < 2) return 0
  let pos = 0
  for (const t of tokens) {
    const i = hay.indexOf(t, pos)
    if (i < 0) return 0
    pos = i + t.length
  }
  return 0.45
}
