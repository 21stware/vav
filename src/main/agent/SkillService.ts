/**
 * Bundled Agent Skills (SKILL.md packages) for the coding agent.
 *
 * Skills live under `resources/agent-skills/` (see NOTICE.md for licenses).
 * The model discovers them via catalog metadata in the system prompt and loads
 * full bodies with the `load_skill` tool (progressive disclosure).
 */
import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { skillsForPrompt } from '@shared/skillCatalog'

export interface SkillCatalogEntry {
  id: string
  name: string
  description: string
  license: string
  source: string
  sourceUrl?: string
  tags: string[]
  dir: string
}

export interface SkillCatalog {
  version: number
  note?: string
  skills: SkillCatalogEntry[]
}

export interface LoadedSkill {
  id: string
  name: string
  path: string
  skillDir: string
  content: string
  license: string
  source: string
  companionFiles: string[]
  truncated: boolean
}

const MAX_BODY = 48_000
const MAX_REMOTE = 80_000

/** Hosts allowed for remote skill fetch (GitHub raw / blob redirects only). */
const REMOTE_HOST_ALLOW = new Set([
  'raw.githubusercontent.com',
  'github.com',
  'gist.githubusercontent.com'
])

export class SkillService {
  private catalogCache: SkillCatalog | null = null
  private rootCache: string | null = null

  /** Absolute path to resources/agent-skills (dev + packaged). */
  root(): string | null {
    if (this.rootCache && existsSync(this.rootCache)) return this.rootCache
    const candidates = [
      join(process.resourcesPath, 'agent-skills'),
      join(app.getAppPath(), 'resources', 'agent-skills'),
      join(app.getAppPath(), '..', 'resources', 'agent-skills'),
      join(__dirname, '../../resources/agent-skills'),
      join(__dirname, '../../../resources/agent-skills'),
      join(process.cwd(), 'resources', 'agent-skills')
    ]
    const hit = candidates.find((p) => existsSync(join(p, 'catalog.json')))
    this.rootCache = hit ?? null
    return this.rootCache
  }

  catalog(): SkillCatalog {
    if (this.catalogCache) return this.catalogCache
    const root = this.root()
    if (!root) {
      this.catalogCache = { version: 1, skills: [], note: 'Skill catalog not found' }
      return this.catalogCache
    }
    try {
      const raw = readFileSync(join(root, 'catalog.json'), 'utf8')
      this.catalogCache = JSON.parse(raw) as SkillCatalog
    } catch (err) {
      console.error('[skills] catalog load failed', err)
      this.catalogCache = { version: 1, skills: [] }
    }
    return this.catalogCache
  }

  /** Compact listing for system prompt (~ few hundred tokens). */
  catalogForPrompt(): string {
    const skills = skillsForPrompt(this.catalog().skills)
    if (skills.length === 0) return '(no bundled skills available)'
    return skills
      .map((s) => {
        const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : ''
        const desc = (s.description || '').slice(0, 160)
        return `- \`${s.id}\`${tags}: ${desc}`
      })
      .join('\n')
  }

  find(idOrName: string): SkillCatalogEntry | null {
    const key = idOrName.trim().toLowerCase()
    if (!key) return null
    const { skills } = this.catalog()
    return (
      skills.find((s) => s.id.toLowerCase() === key) ??
      skills.find((s) => s.name.toLowerCase() === key) ??
      skills.find((s) => s.tags?.some((t) => t.toLowerCase() === key)) ??
      null
    )
  }

  /**
   * Load a bundled skill body, or a relative companion file under the skill dir.
   * @param path optional path relative to the skill folder (e.g. references/editing.md)
   * @param workdir conversation working directory — all generated/temp outputs go here
   */
  loadLocal(
    idOrName: string,
    pathRel?: string | null,
    workdir?: string | null
  ): LoadedSkill | { error: string } {
    const entry = this.find(idOrName)
    if (!entry) {
      const ids = this.catalog()
        .skills.map((s) => s.id)
        .join(', ')
      return { error: `Unknown skill "${idOrName}". Available: ${ids || '(none)'}` }
    }
    const root = this.root()
    if (!root) return { error: 'Skill root not found' }
    const skillDir = join(root, entry.dir)
    if (!existsSync(skillDir)) return { error: `Skill directory missing: ${entry.dir}` }

    const rel = (pathRel ?? '').trim().replace(/^\/+/, '')
    const target = rel ? resolve(skillDir, rel) : join(skillDir, 'SKILL.md')
    // Path traversal guard.
    const normRoot = normalize(skillDir + sep)
    const normTarget = normalize(target)
    if (!normTarget.startsWith(normRoot) && normTarget !== normalize(skillDir)) {
      return { error: 'Invalid path: must stay inside the skill directory' }
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      return {
        error: `File not found: ${rel || 'SKILL.md'}. Companions: ${listCompanions(skillDir).slice(0, 40).join(', ')}`
      }
    }

    let content = readFileSync(target, 'utf8')
    let truncated = false
    if (content.length > MAX_BODY) {
      content =
        content.slice(0, MAX_BODY) +
        `\n\n…[truncated ${content.length - MAX_BODY} characters — request a more specific path under this skill]…`
      truncated = true
    }

    const work = (workdir ?? '').trim() || process.cwd()
    // Skill packages are read-only libraries. Relative paths in SKILL.md
    // (slides/, output/, tmp/) must resolve under WORKDIR, never SKILL_DIR.
    const header = [
      `# Skill: ${entry.id}`,
      `SKILL_DIR=${skillDir}`,
      `WORKDIR=${work}`,
      `Source: ${entry.source} (${entry.license})`,
      entry.sourceUrl ? `URL: ${entry.sourceUrl}` : '',
      rel ? `File: ${rel}` : 'File: SKILL.md',
      '',
      '## PATH RULES (mandatory — overrides examples in the skill body)',
      `- SKILL_DIR is a **read-only** skill package (instructions + helper scripts). Do **not** create, edit, or delete files under SKILL_DIR.`,
      `- WORKDIR is the conversation working directory. Put **all** intermediate and final artifacts there.`,
      `- When the skill text says relative paths like \`slides/\`, \`output/\`, \`./compile.js\`, \`tmp/\`, interpret them as under WORKDIR:`,
      `  - intermediates: \`${work}/slides/\` (or \`${work}/.skill-work/${entry.id}/…\` if you prefer a single staging folder)`,
      `  - final deliverables: \`${work}/…\` (e.g. \`${work}/presentation.pptx\`)`,
      `- To run a helper that lives in the package: call it by absolute path under SKILL_DIR, with cwd=WORKDIR, e.g. \`python3 "$SKILL_DIR/scripts/foo.py" …\` while writing outputs into WORKDIR.`,
      `- Never \`cd\` into SKILL_DIR to write work product. Prefer: \`mkdir -p "$WORKDIR/slides" && cd "$WORKDIR/slides"\`.`,
      '- To load another file from this skill package, call load_skill again with the same name and path=…',
      ''
    ]
      .filter(Boolean)
      .join('\n')

    return {
      id: entry.id,
      name: entry.name,
      path: rel || 'SKILL.md',
      skillDir,
      content: header + content,
      license: entry.license,
      source: entry.source,
      companionFiles: listCompanions(skillDir),
      truncated
    }
  }

  /**
   * Fetch a remote SKILL.md (or markdown skill doc) from an allowlisted host.
   * Prefer bundled skills; remote is for user-provided GitHub skill URLs.
   */
  async loadRemote(url: string): Promise<LoadedSkill | { error: string }> {
    const trimmed = url.trim()
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return { error: 'Invalid URL' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { error: 'Only http(s) skill URLs are allowed' }
    }
    if (!REMOTE_HOST_ALLOW.has(parsed.hostname)) {
      return {
        error: `Host not allowlisted for remote skills: ${parsed.hostname}. Allowed: ${[...REMOTE_HOST_ALLOW].join(', ')}`
      }
    }
    // Normalize github blob URLs to raw.
    let fetchUrl = trimmed
    if (parsed.hostname === 'github.com') {
      const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
      if (m) {
        fetchUrl = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`
      }
    }

    try {
      const body = await httpGetText(fetchUrl, MAX_REMOTE)
      if (!body.ok) return { error: body.error }
      let content = body.text
      let truncated = false
      if (content.length > MAX_BODY) {
        content =
          content.slice(0, MAX_BODY) +
          `\n\n…[truncated ${content.length - MAX_BODY} characters]…`
        truncated = true
      }
      const id = basenameNoExt(fetchUrl)
      return {
        id,
        name: id,
        path: fetchUrl,
        skillDir: '',
        content: `# Remote skill\nURL: ${fetchUrl}\n\n${content}`,
        license: 'remote (verify upstream license before redistributing)',
        source: 'remote',
        companionFiles: [],
        truncated
      }
    } catch (err) {
      return { error: (err as Error).message }
    }
  }
}

function listCompanions(skillDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      try {
        const st = statSync(full)
        if (st.isDirectory()) walk(full, rel)
        else if (st.isFile() && name !== 'SKILL.md') out.push(rel)
      } catch {
        // skip
      }
    }
  }
  walk(skillDir, '')
  return out.sort()
}

function basenameNoExt(url: string): string {
  const base = url.split('/').pop() || 'remote-skill'
  return base.replace(/\.md$/i, '') || 'remote-skill'
}

function httpGetText(
  url: string,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return new Promise((resolvePromise) => {
    const lib = url.startsWith('https') ? httpsRequest : httpRequest
    const req = lib(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'vav-agent-skills/1.0', Accept: 'text/plain, text/markdown, */*' },
        timeout: 20_000
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const next = new URL(res.headers.location, url).toString()
          void httpGetText(next, maxBytes).then(resolvePromise)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          resolvePromise({ ok: false, error: `HTTP ${res.statusCode ?? '?'}` })
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size <= maxBytes) chunks.push(c)
        })
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolvePromise({ ok: true, text })
        })
      }
    )
    req.on('error', (err) => resolvePromise({ ok: false, error: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolvePromise({ ok: false, error: 'Request timed out' })
    })
    req.end()
  })
}

