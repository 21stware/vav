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
export const AGENT_ICONS: Record<string, string> = {
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

export const MONO_MARKS = new Set([
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

export { vavGlyph, vavGlyphDark }
