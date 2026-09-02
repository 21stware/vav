/** Cycle the enabled model list (picker ↑/↓). Null when there is nothing to step. */
export function nextSteppedModelId(
  list: Array<{ id: string }>,
  activeModel: string,
  delta: number
): string | null {
  if (list.length <= 1) return null
  const index = list.findIndex((model) => model.id === activeModel)
  if (index === -1) return list[0]?.id ?? null
  return list[(index + delta + list.length) % list.length]?.id ?? null
}
