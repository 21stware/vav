#!/usr/bin/env node
/**
 * Typecheck the node and web projects in parallel.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const projects = ['tsconfig.node.json', 'tsconfig.web.json']

function run(project) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsc, '--noEmit', '-p', project], {
      cwd: root,
      stdio: 'inherit'
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const codes = await Promise.all(projects.map(run))
process.exit(codes.find((code) => code !== 0) ?? 0)
