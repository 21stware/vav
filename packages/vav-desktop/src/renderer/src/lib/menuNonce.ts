/**
 * Consume a shortcut nonce once, even if the listening component remounts.
 *
 * Category switches unmount SessionDetail; a per-instance ref resets to 0 and
 * would reopen the same native menu from the leftover store nonce.
 */
export function createMenuNonceGate(): (nonce: number) => boolean {
  let last = 0
  return (nonce: number): boolean => {
    if (nonce === 0 || nonce === last) return false
    last = nonce
    return true
  }
}
