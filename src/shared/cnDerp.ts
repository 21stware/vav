/**
 * Mainland DERP hostname (no scheme) for VAV Remote / desktop WAN pairing.
 * Shanghai 锐驰 box; DNS-only A record, not Cloudflare-proxied.
 */
export const VAV_CN_DERP_HOST = 'derp.vavapp.com'

export function sidecarDerpHostArgs(): string[] {
  return VAV_CN_DERP_HOST ? ['--derp-host', VAV_CN_DERP_HOST] : []
}
