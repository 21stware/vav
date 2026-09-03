/** Bound command-output buffers so a runaway process cannot pin the main heap. */
export const COMMAND_BUFFER_CAP = 512 * 1024

export function appendCapped(
  buffer: string,
  chunk: string,
  cap = COMMAND_BUFFER_CAP
): { buffer: string; dropped: number } {
  const next = buffer + chunk
  if (next.length <= cap) return { buffer: next, dropped: 0 }
  const dropped = next.length - cap
  return { buffer: next.slice(dropped), dropped }
}
