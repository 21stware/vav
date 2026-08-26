import type { AgentConfig } from '@shared/types'
import claudeIcon from '../assets/agents/claudecode-color.svg'
import codexIcon from '../assets/agents/codex.svg'
import cursorIcon from '../assets/agents/cursor.svg'
import devinIcon from '../assets/agents/devin.svg'
import grokIcon from '../assets/agents/grok.svg'
import piIcon from '../assets/agents/pi-coding-agent.svg'
import antigravityIcon from '../assets/agents/antigravity.png'
import kiroIcon from '../assets/agents/kiro.svg'
import opencodeIcon from '../assets/agents/opencode.svg'
import clineIcon from '../assets/agents/cline.svg'
import anthropicIcon from '../assets/vendors/anthropic.svg'
import deepseekIcon from '../assets/vendors/deepseek.svg'
import googleIcon from '../assets/vendors/google.svg'
import openaiIcon from '../assets/vendors/openai.svg'
import openrouterIcon from '../assets/vendors/openrouter.svg'
import siliconflowIcon from '../assets/vendors/siliconflow.svg'
import togetherIcon from '../assets/vendors/together.svg'
import xaiIcon from '../assets/vendors/xai.svg'
import bigmodelIcon from '../assets/vendors/bigmodel.svg'
import kimiIcon from '../assets/vendors/kimi.svg'
// VAV: line graphic (wordmark), not the app-icon plate.
import vavGlyph from '../assets/wordmark.png'
import vavGlyphDark from '../assets/wordmark-dark.png'

/** Official / catalogue brand marks from `assets/agents/` + `assets/vendors/` (+ VAV glyph). */
const AGENT_ICONS: Record<string, string> = {
  vav: vavGlyph,
  claude: claudeIcon,
  codex: codexIcon,
  cursor: cursorIcon,
  grok: grokIcon,
  devin: devinIcon,
  pi: piIcon,
  antigravity: antigravityIcon,
  kiro: kiroIcon,
  opencode: opencodeIcon,
  cline: clineIcon,
  deepseek: deepseekIcon,
  openrouter: openrouterIcon,
  openai: openaiIcon,
  anthropic: anthropicIcon,
  xai: xaiIcon,
  google: googleIcon,
  together: togetherIcon,
  siliconflow: siliconflowIcon,
  bigmodel: bigmodelIcon,
  kimi: kimiIcon
}

const MONO_MARKS = new Set([
  'cursor',
  'codex',
  'devin',
  'grok',
  'opencode',
  'cline',
  'kiro',
  'deepseek',
  'openrouter',
  'openai',
  'anthropic',
  'xai',
  'google',
  'together',
  'siliconflow',
  'bigmodel',
  'kimi'
])

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
