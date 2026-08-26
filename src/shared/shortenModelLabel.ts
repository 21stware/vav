/**
 * Drop a redundant provider keyword from a model label.
 *
 * Cursor's "Cursor Grok 3.4" → "Grok 3.4". A strip that leaves only a
 * version token (Grok + "Grok 3.4") is rejected so the brand stays.
 */
export function shortenModelLabel(
  label: string,
  providerName: string | null | undefined
): string {
  const raw = label.trim()
  const keyword = providerName?.trim()
  if (!raw || !keyword) return raw

  let next = raw
  for (const key of providerKeywords(keyword)) {
    const stripped = next
      .replace(keywordPattern(key), ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (stripped && !isVersionish(stripped)) next = stripped
  }
  return next || raw
}

function providerKeywords(name: string): string[] {
  const full = name.trim()
  const first = full.split(/\s+/)[0] ?? ''
  if (first && first.length >= 3 && first.toLowerCase() !== full.toLowerCase()) {
    return [full, first]
  }
  return [full]
}

function keywordPattern(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'gi')
}

function isVersionish(text: string): boolean {
  return /^[\d._-]+$/.test(text)
}
