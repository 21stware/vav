import {
  LUCIDE_MENU_ICON_NODES,
  MENU_ICON_PX,
  type LucideMenuIconKey
} from './menuLucideIcons'

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Well-formed SVG Lucide can load as an image (xmlns + kebab-case attrs). */
export function lucideSvgMarkup(key: LucideMenuIconKey, px = MENU_ICON_PX): string {
  const body = LUCIDE_MENU_ICON_NODES[key]
    .map(([tag, attrs]) => {
      const attr = Object.entries(attrs)
        .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
        .join(' ')
      return `<${tag} ${attr}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}
