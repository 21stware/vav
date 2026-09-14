import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatComputerAppsList,
  mergeComputerApps,
  parseComputerApps,
  parseCuaConnection,
  sanitizeComputerAct,
  sanitizeComputerObserve,
  VAV_CUA_CONNECTION_ENV,
  type ComputerApp,
  type CuaConnectionFile
} from '../../shared/computerUse.ts'
import { callCuaTool, type CuaCallResult } from './CuaDriverClient.ts'
import { readCuaConnectionFile } from './embeddedCua.ts'
import { scanInstalledDesktopApps } from './installedApps.ts'

export type ComputerHost = {
  available: () => boolean
  list: () => Promise<CuaCallResult>
  /** Structured running-app list for the composer @-mention menu. */
  listApps: () => Promise<ComputerApp[]>
  observe: (input: Record<string, unknown>) => Promise<CuaCallResult>
  act: (input: Record<string, unknown>) => Promise<CuaCallResult>
}

export function loadCuaConnection(
  env: NodeJS.ProcessEnv = process.env
): CuaConnectionFile | null {
  const path = env[VAV_CUA_CONNECTION_ENV]?.trim()
  if (path) return readCuaConnectionFile(path)
  return parseCuaConnection({
    socketPath: env.VAV_CUA_SOCKET,
    binPath: env.VAV_CUA_BIN,
    generation: 1,
    startedAt: new Date().toISOString()
  })
}

export function createCuaComputerHost(
  load: () => CuaConnectionFile | null = loadCuaConnection
): ComputerHost {
  const requireConn = (): CuaConnectionFile => {
    const conn = load()
    if (!conn) {
      throw new Error(
        'Computer use is off or the embedded driver is not running. Enable it in Settings → Appearance.'
      )
    }
    return conn
  }

  return {
    available: () => load() != null,
    list: async () => {
      const conn = requireConn()
      const [appsCall, windows] = await Promise.all([
        callCuaTool({
          bin: conn.binPath,
          socket: conn.socketPath,
          tool: 'list_apps',
          timeoutMs: 20_000
        }),
        callCuaTool({
          bin: conn.binPath,
          socket: conn.socketPath,
          tool: 'list_windows',
          timeoutMs: 20_000
        })
      ])
      const apps = mergeComputerApps(
        scanInstalledDesktopApps(),
        parseComputerApps(appsCall.json ?? appsCall.text)
      )
      return {
        ok: windows.ok || apps.length > 0,
        text: ['## Apps', formatComputerAppsList(apps), '', '## Windows', windows.text].join('\n')
      }
    },
    listApps: async () => {
      const installed = scanInstalledDesktopApps()
      const conn = load()
      if (!conn) return installed
      try {
        const apps = await callCuaTool({
          bin: conn.binPath,
          socket: conn.socketPath,
          tool: 'list_apps',
          timeoutMs: 20_000
        })
        return mergeComputerApps(installed, parseComputerApps(apps.json ?? apps.text))
      } catch {
        return installed
      }
    },
    observe: async (input) => {
      const conn = requireConn()
      const policy = sanitizeComputerObserve(input)
      if (!policy.ok) return { ok: false, text: policy.error }
      const screenshotOut = join(mkdtempSync(join(tmpdir(), 'vav-cua-')), 'window.png')
      const result = await callCuaTool({
        bin: conn.binPath,
        socket: conn.socketPath,
        tool: policy.tool,
        args: policy.payload,
        screenshotOut,
        timeoutMs: 45_000
      })
      let shotNote = ''
      try {
        readFileSync(screenshotOut)
        shotNote = `\n\nWindow screenshot written to ${screenshotOut} (same pixels as x,y for click).`
      } catch {
        shotNote = ''
      }
      return { ...result, text: `${result.text}${shotNote}`, screenshotPath: screenshotOut }
    },
    act: async (input) => {
      const conn = requireConn()
      const policy = sanitizeComputerAct(input)
      if (!policy.ok) return { ok: false, text: policy.error }
      return await callCuaTool({
        bin: conn.binPath,
        socket: conn.socketPath,
        tool: policy.tool,
        args: policy.payload,
        timeoutMs: 20_000
      })
    }
  }
}
