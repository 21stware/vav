export function isAssistant<T>(message: T): message is T & { role: 'assistant' } {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { role?: unknown }).role === 'assistant'
  )
}

/** Fallback card text for results pi synthesised itself (blocked, not found). */
export function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
}
