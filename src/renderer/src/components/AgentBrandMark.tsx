import type { AgentConfig } from '@shared/types'
import { AGENT_ICONS, MONO_MARKS, vavGlyph, vavGlyphDark } from '../lib/agentMarkAssets'

/**
 * Agent brand icon for install panel / chrome / settings.
 *
 * Theme adaptation (glyphs must stay readable on light + dark chips):
 * - `is-mono` — dark monochrome (cursor, grok, lobe currentColor marks): invert on dark
 * - `is-mono-on-dark` — light monochrome (pi ships white): invert on light
 * - vav — dual wordmark glyphs (light / dark); never the solid app-icon plate
 */
export function AgentBrandMark({
  agent,
  size = 40
}: {
  agent: Pick<AgentConfig, 'id' | 'name'>
  size?: number
}): React.JSX.Element {
  const src = AGENT_ICONS[agent.id]
  const isVav = agent.id === 'vav'
  // Dark-on-light / currentColor monochrome assets
  const mono = MONO_MARKS.has(agent.id)
  // Light-on-dark assets (Pi SVG fill is #fff)
  const monoOnDark = agent.id === 'pi'

  if (!src) {
    const letter = (agent.name || agent.id || '?').slice(0, 1).toUpperCase()
    return (
      <span
        className="agent-brand-mark agent-brand-mark-fallback"
        style={{
          width: `var(--agent-mark-size, ${size}px)`,
          height: `var(--agent-mark-size, ${size}px)`,
          fontSize: Math.round(size * 0.42)
        }}
        aria-hidden
        title={agent.name}
      >
        {letter}
      </span>
    )
  }

  const classes = [
    'agent-brand-mark',
    mono ? 'is-mono' : '',
    monoOnDark ? 'is-mono-on-dark' : '',
    isVav ? 'agent-brand-mark-vav' : ''
  ]
    .filter(Boolean)
    .join(' ')

  // Same inset as other catalogue glyphs (VAV is a graphic, not a full-bleed plate).
  const imgSize = Math.round(size * 0.72)

  return (
    <span
      className={classes}
      style={{
        width: `var(--agent-mark-size, ${size}px)`,
        height: `var(--agent-mark-size, ${size}px)`
      }}
      title={agent.name}
    >
      {isVav ? (
        <>
          <img
            className="logo-light"
            src={vavGlyph}
            alt=""
            width={imgSize}
            height={imgSize}
            draggable={false}
          />
          <img
            className="logo-dark"
            src={vavGlyphDark}
            alt=""
            width={imgSize}
            height={imgSize}
            draggable={false}
          />
        </>
      ) : (
        <img src={src} alt="" width={imgSize} height={imgSize} draggable={false} />
      )}
    </span>
  )
}
