import type { AgentConfig, CliHostKind } from '@shared/types'
import { isStructuredCliHost } from '@shared/types'
import { resolveAgentExecutable } from '../../terminal/loginPath'
import { startAcpDriver, type AcpHostKind } from './acp'
import { startAntigravityDriver } from './antigravity'
import { startClaudeDriver } from './claude'
import { startCodexDriver } from './codex'
import { startOpenCodeDriver } from './opencode'
import { startPiDriver } from './pi'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

export type { DriverControl, DriverEvent, DriverEventSink, DriverStartOptions } from './types'

const CANDIDATES: Record<CliHostKind, string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  cursor: ['cursor-agent', 'agent', 'cursor'],
  grok: ['grok'],
  opencode: ['opencode'],
  pi: ['pi', 'pi-agent'],
  devin: ['devin'],
  antigravity: ['agy', 'antigravity'],
  kiro: ['kiro-cli', 'kiro'],
  cline: ['cline']
}

const ACP_HOSTS = new Set<CliHostKind>(['cursor', 'grok', 'devin', 'kiro', 'cline'])

export function candidatesForHost(kind: CliHostKind, agent?: AgentConfig | null): string[] {
  const fromSettings = [
    agent?.binaryPath,
    ...(agent?.binaryCandidates ?? [])
  ].filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
  return [...new Set([...fromSettings, ...CANDIDATES[kind]])]
}

export async function resolveHostBinary(
  kind: CliHostKind,
  agent?: AgentConfig | null,
  force = false
): Promise<string | null> {
  return resolveAgentExecutable(candidatesForHost(kind, agent), { force })
}

export async function startDriver(
  kind: CliHostKind,
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  switch (kind) {
    case 'claude':
      return startClaudeDriver(options, emit)
    case 'codex':
      return startCodexDriver(options, emit)
    case 'opencode':
      return startOpenCodeDriver(options, emit)
    case 'pi':
      return startPiDriver(options, emit)
    case 'antigravity':
      return startAntigravityDriver(options, emit)
    case 'cursor':
    case 'grok':
    case 'devin':
    case 'kiro':
    case 'cline':
      return startAcpDriver(kind as AcpHostKind, options, emit)
  }
}

export function isAcpHost(kind: CliHostKind): kind is AcpHostKind {
  return ACP_HOSTS.has(kind)
}

export { isStructuredCliHost }
