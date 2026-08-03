/**
 * Privileged local-file URL for in-app streaming previews (PDF, media, office).
 * Served by main via `protocol.handle('vav-local', …)` with Range support.
 */
export function localFileStreamUrl(filePath: string): string {
  return `vav-local://preview/?path=${encodeURIComponent(filePath)}`
}
