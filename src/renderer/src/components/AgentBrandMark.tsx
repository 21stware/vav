import type { AgentConfig } from '@shared/types'
import claudeIcon from '../assets/agents/claudecode-color.svg'
import codexIcon from '../assets/agents/codex-color.svg'
import cursorIcon from '../assets/agents/cursor.svg'
import devinIcon from '../assets/agents/devin-color.svg'
import grokIcon from '../assets/agents/grok.svg'
import piIcon from '../assets/agents/pi-coding-agent.svg'
import antigravityIcon from '../assets/agents/antigravity.png'
import kiroIcon from '../assets/agents/kiro.svg'
import opencodeIcon from '../assets/agents/opencode.svg'
import clineIcon from '../assets/agents/cline.svg'
// Product mark — full app-icon plates (Any light / Any dark). Theme via CSS, no invert.
import vavIcon from '../assets/agents/vav-mark.png'
import vavIconDark from '../assets/agents/vav-mark-dark.png'

/** Official / catalogue brand marks from `assets/agents/`. */
const AGENT_ICONS: Record<string, string> = {
  vav: vavIcon,
  claude: claudeIcon,
  codex: codexIcon,
  cursor: cursorIcon,
  grok: grokIcon,
  devin: devinIcon,
  pi: piIcon,
  antigravity: antigravityIcon,
  kiro: kiroIcon,
  opencode: opencodeIcon,
  cline: clineIcon
}

/**
 * Agent brand icon for install panel / chrome / settings.
 *
 * Theme adaptation (glyphs must stay readable on light + dark chips):
 * - `is-mono` — dark monochrome (cursor, grok, lobe currentColor marks): invert on dark
 * - `is-mono-on-dark` — light monochrome (pi ships white): invert on light
 * - vav — dual PNG plates (light / dark Any); never invert (solid app icon)
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
  const mono =
    agent.id === 'cursor' ||
    agent.id === 'grok' ||
    agent.id === 'opencode' ||
    agent.id === 'cline' ||
    agent.id === 'kiro'
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

  // Full-bleed app icon fills the chip; other logos keep a small inset.
  const imgSize = Math.round(size * (isVav ? 1 : 0.72))

  return (
    <span className={classes} style={{ width: size, height: size }} title={agent.name}>
      {isVav ? (
        <>
          <img
            className="logo-light"
            src={vavIcon}
            alt=""
            width={imgSize}
            height={imgSize}
            draggable={false}
          />
          <img
            className="logo-dark"
            src={vavIconDark}
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
