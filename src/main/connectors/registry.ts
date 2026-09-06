import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import {
  CONNECTOR_CATALOG,
  connectorCan,
  connectorDescriptor,
  parseConnectorAction,
  type ConnectorActionRequest,
  type ConnectorActionResult,
  type ConnectorAuth,
  type ConnectorId,
  type ConnectorProbe
} from '@shared/connector'
import { parseGithubRemote } from '@shared/github'
import { getCloudflareStatus, scanCloudflareWorkspace } from '../cloudflare/CloudflareService'
import { getSupabaseStatus } from '../supabase/SupabaseService'
import { getVercelStatus, isVercelWorkspace } from './vercel'
import { deployConnector, type ConnectorCreds } from './deploy'
import { loginPath } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)

export type ConnectorRegistryDeps = {
  creds: () => ConnectorCreds
}

async function githubBinding(cwd: string): Promise<{ present: boolean; label: string | null }> {
  const abs = resolve(cwd)
  if (!existsSync(abs)) return { present: false, label: null }
  try {
    const { stdout } = await execFileAsync('git', ['remote', '-v'], {
      cwd: abs,
      timeout: 8_000,
      env: { ...process.env, PATH: loginPath(), GIT_TERMINAL_PROMPT: '0' }
    })
    for (const line of stdout.toString().split('\n')) {
      const m = /^\S+\s+(\S+)\s+\(fetch\)/.exec(line.trim())
      if (!m) continue
      const ref = parseGithubRemote(m[1]!)
      if (ref) return { present: true, label: ref.fullName }
    }
  } catch {
    // not a git repo / no remotes
  }
  return { present: false, label: null }
}

function githubAuth(): ConnectorAuth {
  if ((process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()) {
    return { present: true, source: 'env' }
  }
  return { present: false, source: 'cli' }
}

export function createConnectorRegistry(deps: ConnectorRegistryDeps) {
  async function probeOne(id: ConnectorId, cwd: string): Promise<ConnectorProbe> {
    const desc = connectorDescriptor(id)
    const creds = deps.creds()
    if (id === 'github') {
      const binding = await githubBinding(cwd)
      return {
        id,
        binding: { present: binding.present, label: binding.label, configPath: null },
        auth: githubAuth(),
        capabilities: [...desc.capabilities]
      }
    }
    if (id === 'cloudflare') {
      const scanned = scanCloudflareWorkspace(cwd)
      const status = scanned.ok
        ? await getCloudflareStatus(cwd, creds.cloudflare, { remote: false })
        : null
      const data = status?.ok ? status.data : null
      return {
        id,
        binding: {
          present: scanned.ok,
          label: data?.config?.name ?? null,
          configPath: data?.config?.relativePath ?? null
        },
        auth: { present: Boolean(data?.tokenPresent), source: data?.tokenSource ?? null },
        capabilities: [...desc.capabilities]
      }
    }
    if (id === 'supabase') {
      const status = await getSupabaseStatus(cwd, creds.supabase, { remote: false })
      const data = status.ok ? status.data : null
      return {
        id,
        binding: {
          present: Boolean(data?.present),
          label: data?.projectRef ?? data?.config?.projectId ?? null,
          configPath: data?.config?.relativePath ?? null
        },
        auth: { present: Boolean(data?.tokenPresent), source: data?.tokenSource ?? null },
        capabilities: [...desc.capabilities]
      }
    }
    const present = isVercelWorkspace(cwd)
    const status = present ? await getVercelStatus(cwd, creds.vercel, { remote: false }) : null
    const data = status?.ok ? status.data : null
    return {
      id,
      binding: {
        present,
        label: data?.config?.projectName ?? null,
        configPath: data?.config?.relativePath ?? null
      },
      auth: { present: Boolean(data?.tokenPresent), source: data?.tokenSource ?? null },
      capabilities: [...desc.capabilities]
    }
  }

  return {
    catalog: () => CONNECTOR_CATALOG.map((row) => ({ ...row, capabilities: [...row.capabilities] })),

    async probe(cwd: string): Promise<ConnectorProbe[]> {
      const rows: ConnectorProbe[] = []
      for (const desc of CONNECTOR_CATALOG) {
        rows.push(await probeOne(desc.id, cwd))
      }
      return rows
    },

    async act(request: ConnectorActionRequest): Promise<ConnectorActionResult> {
      const action = parseConnectorAction(request.action)
      if (!action) return { ok: false, error: 'Unknown connector action', code: 'bad-action' }
      if (!connectorCan(request.connector, 'deploy')) {
        return { ok: false, error: `${request.connector} does not deploy`, code: 'read-only' }
      }
      return deployConnector(request.connector, request.cwd, deps.creds())
    }
  }
}

export type ConnectorRegistry = ReturnType<typeof createConnectorRegistry>
