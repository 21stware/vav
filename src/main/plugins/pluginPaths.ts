import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeConfigDir, codexHome, grokHome } from '../quota/hostPaths.ts'
import type { PluginHostKind } from '../../shared/plugins.ts'

export function vavHome(home = homedir()): string {
  return process.env.VAV_HOME?.trim() || join(home, '.vav')
}

export function cursorHome(home = homedir()): string {
  return process.env.CURSOR_HOME?.trim() || join(home, '.cursor')
}

export function pluginRootsForHost(
  host: PluginHostKind,
  home = homedir()
): { root: string; scan: string[] } {
  switch (host) {
    case 'vav': {
      const root = vavHome(home)
      return { root, scan: [join(root, 'plugins'), join(root, 'skills')] }
    }
    case 'cursor': {
      const root = join(cursorHome(home), 'plugins')
      return { root, scan: [join(root, 'local'), join(root, 'cache'), root] }
    }
    case 'claude': {
      const root = claudeConfigDir()
      return {
        root,
        scan: [join(root, 'plugins'), join(root, 'skills')]
      }
    }
    case 'grok': {
      const root = grokHome()
      return { root, scan: [join(root, 'plugins'), join(root, 'skills'), root] }
    }
    case 'codex': {
      const root = codexHome()
      return { root, scan: [join(root, 'plugins'), join(root, 'skills'), root] }
    }
    case 'pi': {
      const root = join(home, '.pi')
      return { root, scan: [join(root, 'plugins'), join(root, 'agent', 'skills'), root] }
    }
    case 'opencode': {
      const root = process.env.XDG_DATA_HOME?.trim()
        ? join(process.env.XDG_DATA_HOME.trim(), 'opencode')
        : join(home, '.local', 'share', 'opencode')
      return { root, scan: [join(root, 'plugins'), join(root, 'skills'), root] }
    }
    case 'devin':
    case 'kiro':
    case 'cline':
    case 'antigravity': {
      const root = join(home, `.${host}`)
      return { root, scan: [join(root, 'plugins'), join(root, 'skills'), root] }
    }
  }
}

/** Dirs / files FileService must allow so the tray can open the same files the agent reads. */
export function pluginAccessPaths(host: PluginHostKind, home = homedir()): string[] {
  const { root, scan } = pluginRootsForHost(host, home)
  const paths = [root, ...scan]
  if (host === 'vav') {
    const files = vavStateFiles(home)
    paths.push(files.home, files.enabled, files.mcp, files.hooks, files.pluginsDir, files.skillsDir)
  }
  if (host === 'cursor') {
    paths.push(join(cursorHome(home), 'mcp.json'))
  }
  return [...new Set(paths.filter(Boolean))]
}

export function vavStateFiles(home = homedir()): {
  home: string
  enabled: string
  mcp: string
  hooks: string
  pluginsDir: string
  skillsDir: string
} {
  const root = vavHome(home)
  return {
    home: root,
    enabled: join(root, 'plugins.json'),
    mcp: join(root, 'mcp.json'),
    hooks: join(root, 'hooks.json'),
    pluginsDir: join(root, 'plugins'),
    skillsDir: join(root, 'skills')
  }
}
