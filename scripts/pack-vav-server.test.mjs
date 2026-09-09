import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Isolated --dir so a parallel sidecar pack cannot tear the 7MB bundle mid-load. */
test('pack-vav-server writes electron-free bins that print a pairing URI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vav-server-packdir-'))
  const packed = spawnSync(
    process.execPath,
    [join(root, 'scripts/pack-vav-server.mjs'), '--dir', dir],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VAV_PACK_QUIET: '1' }
    }
  )
  assert.equal(packed.status, 0, packed.stderr || packed.stdout)

  const serverJs = join(dir, 'vav-server.js')
  const boardJs = join(dir, 'vav-board.js')
  const tuiJs = join(dir, 'vav-tui.js')
  assert.ok(existsSync(serverJs))
  assert.ok(existsSync(boardJs))
  assert.ok(existsSync(tuiJs))

  const server = readFileSync(serverJs, 'utf8')
  const board = readFileSync(boardJs, 'utf8')
  const tui = readFileSync(tuiJs, 'utf8')
  assert.ok(server.startsWith('#!/usr/bin/env node'))
  assert.ok(board.startsWith('#!/usr/bin/env node'))
  assert.ok(tui.startsWith('#!/usr/bin/env node'))
  for (const code of [server, board, tui]) {
    assert.ok(!code.includes('from "electron"') && !code.includes("from 'electron'"))
  }

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, rootPkg.version)
  assert.deepEqual(pkg.bin, {
    'vav-server': 'vav-server.js',
    vavd: 'vav-server.js',
    'vav-board': 'vav-board.js',
    vavc: 'vav-board.js',
    'vav-tui': 'vav-tui.js',
    vavcli: 'vav-tui.js'
  })
  assert.ok(!pkg.dependencies?.electron)

  const state = mkdtempSync(join(tmpdir(), 'vav-server-pack-'))
  const child = spawn(
    process.execPath,
    [serverJs, '--port', '0', '--listen', '127.0.0.1', '--state', state, '--no-web', '--no-announce', '--name', 'Pack Test'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_PATH: join(root, 'node_modules') }
    }
  )
  try {
    const pairing = await new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => reject(new Error(`packed vav-server silent\n${stdout}\n${stderr}`)), 12_000)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const line = stdout
          .split('\n')
          .find((row) => row.startsWith('vavrtp://') || row.startsWith('vav-daemon:'))
        if (line) {
          clearTimeout(timer)
          resolve(line.trim())
        }
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`packed vav-server exited ${code}: ${stderr || stdout}`))
      })
    })
    assert.match(pairing, /^(vavrtp:\/\/|vav-daemon:)/)
    assert.match(pairing, /Pack%20Test|Pack Test|name=Pack/)
  } finally {
    await stopPackedVavServer(child)
    rmSync(state, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

function stopPackedVavServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) {
      resolve()
      return
    }
    const finish = () => resolve()
    child.once('exit', finish)
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
    }, 1500)
  })
}
