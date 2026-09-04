/**
 * Move a Temporary Workspace onto a durable folder.
 *
 * Source is `$TMPDIR/vav/<8 hex>/Workspace`. Destination receives that
 * container's children, so it contains `Workspace` for later management.
 */

import { cpSync, rmdirSync, rmSync } from 'node:fs'
import { planLocateTempDir, tempDirContainer } from '../../shared/locateTempDir.ts'
import type { HostFs } from '../host/HostFs.ts'

export type LocateTempWorkspaceResult =
  | { ok: true; nextWorkdir: string }
  | { ok: false; error: 'not-temp' | 'exists'; target?: string }

function isExdev(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'EXDEV'
  )
}

async function movePath(
  from: string,
  to: string,
  fs: Pick<HostFs, 'rename'>,
  crossDeviceCopy: boolean
): Promise<void> {
  try {
    await fs.rename(from, to)
  } catch (err) {
    if (!crossDeviceCopy || !isExdev(err)) throw err
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false })
    rmSync(from, { recursive: true, force: true })
  }
}

export async function locateTempWorkspaceToDir(input: {
  workdir: string
  destinationDir: string
  platform?: string
  fs: Pick<HostFs, 'readdir' | 'exists' | 'mkdir' | 'rename'>
  /** Local disk: fall back to copy+remove when rename hits EXDEV. */
  crossDeviceCopy?: boolean
}): Promise<LocateTempWorkspaceResult> {
  const container = tempDirContainer(input.workdir)
  if (!container) return { ok: false, error: 'not-temp' }

  let names: string[]
  try {
    names = (await input.fs.readdir(container)).map((entry) => entry.name)
  } catch {
    return { ok: false, error: 'not-temp' }
  }

  const plan = planLocateTempDir(
    input.workdir,
    input.destinationDir,
    names,
    input.platform ?? process.platform
  )
  if (!plan.ok) return { ok: false, error: 'not-temp' }
  if (!plan.moves.some((move) => move.to === plan.nextWorkdir)) {
    return { ok: false, error: 'not-temp' }
  }

  await input.fs.mkdir(input.destinationDir, { recursive: true })
  for (const move of plan.moves) {
    if (await input.fs.exists(move.to)) {
      return { ok: false, error: 'exists', target: move.to }
    }
  }

  for (const move of plan.moves) {
    await movePath(move.from, move.to, input.fs, input.crossDeviceCopy === true)
  }

  if (input.crossDeviceCopy) {
    for (const dir of plan.cleanup) {
      try {
        rmdirSync(dir)
      } catch {
        // leave leftover empty dirs
      }
    }
  }

  return { ok: true, nextWorkdir: plan.nextWorkdir }
}
