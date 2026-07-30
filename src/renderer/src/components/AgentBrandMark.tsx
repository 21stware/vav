import type { AgentConfig } from '@shared/types'
import claudeIcon from '../assets/agents/claudecode-color.svg'
import codexIcon from '../assets/agents/codex-color.svg'
import cursorIcon from '../assets/agents/cursor.svg'
import devinIcon from '../assets/agents/devin-color.svg'
import grokIcon from '../assets/agents/grok.svg'
import piIcon from '../assets/agents/pi-coding-agent.svg'
// Product mark (Dock / tray family) — not a generic Lucide icon.
import vavIcon from '../assets/agents/vav-mark.png'

/** Official brand marks from `static/` (copied into renderer assets). */
const AGENT_ICONS: Record<string, string> = {
  vav: vavIcon,
  claude: claudeIcon,
  codex: codexIcon,
  cursor: cursorIcon,
  grok: grokIcon,
  devin: devinIcon,
  pi: piIcon
}

/**
 * Agent brand icon for install panel / chrome.
 *
 * Theme adaptation (glyphs must stay readable on light + dark chips):
 * - `is-mono` — dark monochrome (cursor, grok): invert on dark
 * - `is-mono-on-dark` — light monochrome (pi ships white): invert on light
 * - `agent-brand-mark-vav` — product mark (dark ink + lavender): lighten on dark
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
  // Dark-on-light assets
  const mono = agent.id === 'cursor' || agent.id === 'grok'
  // Light-on-dark assets (Pi SVG fill is #fff)
  const monoOnDark = agent.id === 'pi'

  if (!src) {
    const letter = (agent.name || agent.id || '?').slice(0, 1).toUpperCase()
    return (
      <span
        className="agent-brand-mark agent-brand-mark-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
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

  return (
    <span className={classes} style={{ width: size, height: size }} title={agent.name}>
      <img
        src={src}
        alt=""
        width={Math.round(size * (isVav ? 0.78 : 0.72))}
        height={Math.round(size * (isVav ? 0.78 : 0.72))}
        draggable={false}
      />
    </span>
  )
}
