/**
 * Writing length for notes and schedule prompts.
 * CJK characters each count as one unit; a Latin or numeric run counts as one.
 * That matches how Chinese editors report 字数 for mixed prose.
 */
const WRITING_UNIT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|(?:[\p{Letter}\p{Number}]+(?:['’][\p{Letter}\p{Number}]+)*)/gu

export function countWritingUnits(text: string): number {
  if (!text) return 0
  const matches = text.match(WRITING_UNIT)
  return matches ? matches.length : 0
}

/** One quiet line for a list row: `创建 刚刚 · 更新 昨天 · 字数 12`. */
export function joinListFacts(
  parts: ReadonlyArray<{ label: string; value: string | number | null | undefined }>
): string {
  return parts
    .filter((part) => part.value != null && String(part.value) !== '')
    .map((part) => `${part.label} ${part.value}`)
    .join(' · ')
}
