import { mainlandDerpHost } from './edition.ts'

/**
 * Mainland DERP hostname (no scheme) for VAV Remote / desktop WAN pairing.
 * Always from edition/cn.json so every baked face keeps the union relay.
 */
export const VAV_CN_DERP_HOST = mainlandDerpHost()

export function sidecarDerpHostArgs(): string[] {
  return VAV_CN_DERP_HOST ? ['--derp-host', VAV_CN_DERP_HOST] : []
}
