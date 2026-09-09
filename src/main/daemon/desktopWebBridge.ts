/**
 * Loopback HTTP + WS for the Chrome extension / bundled page when the
 * desktop app is the host (in-process hub, no child vav-server).
 */
import { VAV_SERVER_WEB_DEFAULT_PORT, webScanPorts } from '../../shared/vavDiscover.ts'
import { startVavWebBridge, type VavWebBridgeOpts } from './VavWebBridge.ts'

export async function startDesktopWebBridge(
  opts: Omit<VavWebBridgeOpts, 'listen' | 'port'> & { port?: number }
): Promise<{ close: () => void; port: number } | null> {
  const preferred = opts.port ?? VAV_SERVER_WEB_DEFAULT_PORT
  const ports = preferred === 0 ? [0] : webScanPorts([preferred])
  for (const port of ports) {
    try {
      return await startVavWebBridge({
        ...opts,
        listen: '127.0.0.1',
        port
      })
    } catch {
      /* try the next well-known port */
    }
  }
  return null
}
