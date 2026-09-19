/**
 * POSIX listen-port snapshot for a PTY process tree.
 *
 * Used by PtyManager (tab titles + local marks) and DaemonServer (remote
 * port-forward discovery). Empty on Windows / when lsof is missing.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { normalizeListenPorts } from '../../shared/ptyPorts.ts'

const execFileAsync = promisify(execFile)
const IS_WINDOWS = process.platform === 'win32'

export type ProcRow = {
  pid: number
  ppid: number
  comm: string
  args: string
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -F pn` (`p<pid>` / `n*:port`). */
export function parseLsofListen(stdout: string): Map<number, number[]> {
  const map = new Map<number, number[]>()
  let pid = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number.parseInt(line.slice(1), 10) || 0
    } else if (line.startsWith('n') && pid > 0) {
      const m = line.match(/:(\d+)\s*$/)
      if (!m) continue
      const port = Number.parseInt(m[1]!, 10)
      if (!Number.isFinite(port) || port <= 0) continue
      const list = map.get(pid) ?? []
      if (!list.includes(port)) list.push(port)
      map.set(pid, list)
    }
  }
  return map
}

/** Parse `ps -axo pid=,ppid=,command=` style lines. */
export function parsePsRows(stdout: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    const pid = Number.parseInt(m[1]!, 10)
    const ppid = Number.parseInt(m[2]!, 10)
    const args = m[3]!.trim()
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !args) continue
    const first = args.split(/\s+/)[0] || args
    const comm = first.split(/[/\\]/).pop() || first
    rows.push({ pid, ppid, comm, args })
  }
  return rows
}

export async function listProcessRows(): Promise<ProcRow[]> {
  try {
    if (IS_WINDOWS) {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.Name,(($_.CommandLine) -replace '[\\r\\n|]', ' ') }"
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 4000 }
      )
      const rows: ProcRow[] = []
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split('|')
        if (parts.length < 3) continue
        const pid = Number.parseInt(parts[0]!, 10)
        const ppid = Number.parseInt(parts[1]!, 10)
        const comm = (parts[2] || 'process').replace(/\.exe$/i, '')
        const args = parts.slice(3).join('|') || comm
        if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
        rows.push({ pid, ppid, comm, args })
      }
      return rows
    }
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 3000
    })
    return parsePsRows(stdout)
  } catch {
    return []
  }
}

/** pid → listening TCP ports (LISTEN). Empty on Windows / when lsof is missing. */
export async function listeningPortsByPid(): Promise<Map<number, number[]>> {
  if (IS_WINDOWS) return new Map()
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 2500 }
    )
    return parseLsofListen(stdout)
  } catch {
    return new Map()
  }
}

export function childrenByParent(rows: ProcRow[]): Map<number, ProcRow[]> {
  const map = new Map<number, ProcRow[]>()
  for (const row of rows) {
    const list = map.get(row.ppid)
    if (list) list.push(row)
    else map.set(row.ppid, [row])
  }
  return map
}

export function collectTreePids(root: number, byParent: Map<number, ProcRow[]>): number[] {
  const out: number[] = []
  const stack = [root]
  const seen = new Set<number>()
  while (stack.length) {
    const pid = stack.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    out.push(pid)
    for (const kid of byParent.get(pid) ?? []) stack.push(kid.pid)
  }
  return out
}

export function portsForTree(
  rootPid: number,
  byParent: Map<number, ProcRow[]>,
  portsByPid: Map<number, number[]>
): number[] {
  const ports: number[] = []
  for (const pid of collectTreePids(rootPid, byParent)) {
    for (const port of portsByPid.get(pid) ?? []) {
      if (!ports.includes(port)) ports.push(port)
    }
  }
  return normalizeListenPorts(ports)
}
