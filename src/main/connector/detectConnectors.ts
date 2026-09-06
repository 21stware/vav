import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { isIgnoredName } from '@shared/types'
import type { ConnectorDetect, ConnectorId } from '@shared/connector'
import { isWranglerConfigName } from '@shared/cloudflareConfig'
import { isSupabaseConfigName } from '@shared/supabaseConfig'
import { isVercelConfigName, isVercelProjectFile, parseVercelProjectName } from '@shared/vercelConfig'
import { parseGithubRemote } from '@shared/github'

const WALK_DIR_CAP = 80
const EXTRA_SKIP = new Set([
  'dist',
  'out',
  'build',
  'release',
  'coverage',
  '.wrangler',
  '.next',
  '.output',
  '.turbo',
  '.cache',
  'target',
  'node_modules'
])

function walkFiles(root: string, pred: (name: string, rel: string) => boolean): string[] {
  const out: string[] = []
  const stack = [root]
  let dirs = 0
  while (stack.length && dirs < WALK_DIR_CAP) {
    const dir = stack.pop()!
    dirs += 1
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (isIgnoredName(entry.name) || EXTRA_SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = relative(root, full) || entry.name
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile() && pred(entry.name, rel)) out.push(full)
    }
  }
  return out
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function detectGithub(cwd: string): ConnectorDetect {
  try {
    const git = join(resolve(cwd), '.git')
    if (!existsSync(git)) {
      return { id: 'github', present: false, label: null, configPath: null }
    }
  } catch {
    return { id: 'github', present: false, label: null, configPath: null }
  }
  const config = join(resolve(cwd), '.git', 'config')
  const text = readText(config) ?? ''
  const urlMatch = /url\s*=\s*(\S+)/.exec(text)
  const ref = urlMatch ? parseGithubRemote(urlMatch[1]!) : null
  return {
    id: 'github',
    present: Boolean(ref),
    label: ref?.fullName ?? null,
    configPath: existsSync(config) ? config : null
  }
}

function detectCloudflare(cwd: string): ConnectorDetect {
  const files = walkFiles(resolve(cwd), (name) => isWranglerConfigName(name))
  const path = files[0] ?? null
  return {
    id: 'cloudflare',
    present: Boolean(path),
    label: path ? basename(path) : null,
    configPath: path
  }
}

function detectSupabase(cwd: string): ConnectorDetect {
  const files = walkFiles(resolve(cwd), (name) => isSupabaseConfigName(name))
  const path =
    files.find((p) => basename(resolve(p, '..')).toLowerCase() === 'supabase') ?? files[0] ?? null
  return {
    id: 'supabase',
    present: Boolean(path),
    label: path ? 'supabase' : null,
    configPath: path
  }
}

function detectVercel(cwd: string): ConnectorDetect {
  const files = walkFiles(resolve(cwd), (name, rel) => isVercelConfigName(name) || isVercelProjectFile(rel))
  files.sort((a, b) => a.length - b.length)
  const path = files[0] ?? null
  const label = path ? parseVercelProjectName(readText(path) ?? '') : null
  return {
    id: 'vercel',
    present: Boolean(path),
    label,
    configPath: path
  }
}

const DETECT: Record<ConnectorId, (cwd: string) => ConnectorDetect> = {
  github: detectGithub,
  cloudflare: detectCloudflare,
  supabase: detectSupabase,
  vercel: detectVercel
}

export function detectConnector(id: ConnectorId, cwd: string): ConnectorDetect {
  try {
    const abs = resolve(cwd)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return { id, present: false, label: null, configPath: null }
    }
    return DETECT[id](abs)
  } catch {
    return { id, present: false, label: null, configPath: null }
  }
}

export function detectConnectors(cwd: string): ConnectorDetect[] {
  return (Object.keys(DETECT) as ConnectorId[]).map((id) => detectConnector(id, cwd))
}
