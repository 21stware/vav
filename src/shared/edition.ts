/**
 * Distribution face (CN vs global). Same kernel; defaults differ.
 * Generated values live in `edition.generated.ts` (`scripts/apply-edition.mjs`).
 */
import { EDITION_ID, EDITIONS } from './edition.generated.ts'

export type EditionId = 'global' | 'cn'

export type Edition = {
  id: EditionId
  site: string
  derpHost: string
  /** `github` or a generic electron-updater directory URL. */
  updateFeed: string
  githubProxy: boolean
  defaultLocale: string | null
  legal: { icp?: string }
}

export function parseEditionId(value: unknown): EditionId {
  return value === 'cn' ? 'cn' : 'global'
}

export function editionById(id: EditionId = EDITION_ID): Edition {
  return EDITIONS[id] ?? EDITIONS.global
}

export function activeEdition(): Edition {
  return editionById(EDITION_ID)
}

/** Mainland relay — always from the CN edition so every binary keeps the union. */
export function mainlandDerpHost(): string {
  return (EDITIONS.cn?.derpHost || '').trim()
}

export function editionSite(id: EditionId = EDITION_ID): string {
  return editionById(id).site
}

export function editionGenericUpdateFeed(): string | null {
  const feed = activeEdition().updateFeed.trim()
  if (!feed || feed === 'github') return null
  return feed.replace(/\/$/, '')
}
