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
test('pack-vavd writes electron-free bins that print a pairing URI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vavd-packdir-'))
  const packed = spawnSync(
    process.execPath,
    [join(root, 'scripts/pack-vavd.mjs'), '--dir', dir],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VAV_PACK_QUIET: '1' }
    }
  )
  assert.equal(packed.status, 0, packed.stderr || packed.stdout)

  const vavdJs = join(dir, 'vavd.js')
  const vavJs = join(dir, 'vav.js')
  assert.ok(existsSync(vavdJs))
  assert.ok(existsSync(vavJs))

  const vavd = readFileSync(vavdJs, 'utf8')
  const cli = readFileSync(vavJs, 'utf8')
  assert.ok(vavd.startsWith('#!/usr/bin/env node'))
  assert.ok(cli.startsWith('#!/usr/bin/env node'))
  assert.ok(!vavd.includes('from "electron"') && !vavd.includes("from 'electron'"))
  assert.ok(!cli.includes('from "electron"') && !cli.includes("from 'electron'"))

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, rootPkg.version)
  assert.deepEqual(pkg.bin, { vavd: 'vavd.js', vav: 'vav.js' })
  assert.ok(!pkg.dependencies?.electron)

  const state = mkdtempSync(join(tmpdir(), 'vavd-pack-'))
  const child = spawn(
    process.execPath,
    [vavdJs, '--port', '0', '--listen', '127.0.0.1', '--state', state, '--no-web', '--no-announce', '--name', 'Pack Test'],
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
      const timer = setTimeout(() => reject(new Error(`packed vavd silent\n${stdout}\n${stderr}`)), 12_000)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const line = stdout.split('\n').find((row) => row.startsWith('vav-daemon:'))
        if (line) {
          clearTimeout(timer)
          resolve(line.trim())
        }
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`packed vavd exited ${code}: ${stderr || stdout}`))
      })
    })
    assert.match(pairing, /^vav-daemon:/)
    assert.match(pairing, /Pack%20Test|Pack Test|name=Pack/)
  } finally {
    child.kill('SIGTERM')
    rmSync(state, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
