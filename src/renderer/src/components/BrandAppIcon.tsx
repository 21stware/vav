/**
 * iOS Icon Composer appearance set for the VAV app icon.
 *
 * Exports under brand/icon Exports/ ship six 1024 masters:
 *   Any (Default / Dark) · Clear (Light / Dark) · Tinted (Light / Dark)
 *
 * Web picks a pair by appearance + resolved theme (light/dark), same idea as
 * iOS Home Screen: Any = full brand, Clear = glass emboss, Tinted = monochrome
 * accent plate. CSS swaps light/dark via data-theme like other brand marks.
 */
import anyLight from '../assets/icon/any-light.png'
import anyLight2x from '../assets/icon/any-light@2x.png'
import anyDark from '../assets/icon/any-dark.png'
import anyDark2x from '../assets/icon/any-dark@2x.png'
import clearLight from '../assets/icon/clear-light.png'
import clearLight2x from '../assets/icon/clear-light@2x.png'
import clearDark from '../assets/icon/clear-dark.png'
import clearDark2x from '../assets/icon/clear-dark@2x.png'
import tintedLight from '../assets/icon/tinted-light.png'
import tintedLight2x from '../assets/icon/tinted-light@2x.png'
import tintedDark from '../assets/icon/tinted-dark.png'
import tintedDark2x from '../assets/icon/tinted-dark@2x.png'
import { useSessionStore } from '../state/sessionStore'
import type { ColorTint } from '@shared/types'

export type BrandIconAppearance = 'any' | 'clear' | 'tinted' | 'auto'

const LAYERS = {
  any: {
    light: { src: anyLight, src2x: anyLight2x },
    dark: { src: anyDark, src2x: anyDark2x }
  },
  clear: {
    light: { src: clearLight, src2x: clearLight2x },
    dark: { src: clearDark, src2x: clearDark2x }
  },
  tinted: {
    light: { src: tintedLight, src2x: tintedLight2x },
    dark: { src: tintedDark, src2x: tintedDark2x }
  }
} as const

/** Mono chrome keeps full Any; colour tints use the Tinted plate. */
function resolveAppearance(tint: ColorTint | undefined, forced: BrandIconAppearance): 'any' | 'clear' | 'tinted' {
  if (forced !== 'auto') return forced
  if (!tint || tint === 'mono') return 'any'
  // Lavender / system / hue tints → Tinted masters (brand emboss on accent plate).
  return 'tinted'
}

export function BrandAppIcon({
  size = 96,
  appearance = 'auto',
  className,
  label = 'VAV'
}: {
  size?: number
  /** Force an Icon Composer layer, or auto from color tint. */
  appearance?: BrandIconAppearance
  className?: string
  label?: string
}): React.JSX.Element {
  const colorTint = useSessionStore((s) => s.settings.colorTint)
  const layer = resolveAppearance(colorTint, appearance)
  const pair = LAYERS[layer]

  return (
    <span
      className={['brand-app-icon', className].filter(Boolean).join(' ')}
      data-appearance={layer}
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
    >
      <img
        className="logo-light"
        src={pair.light.src}
        srcSet={`${pair.light.src} 1x, ${pair.light.src2x} 2x`}
        alt=""
        draggable={false}
      />
      <img
        className="logo-dark"
        src={pair.dark.src}
        srcSet={`${pair.dark.src} 1x, ${pair.dark.src2x} 2x`}
        alt=""
        draggable={false}
      />
    </span>
  )
}
