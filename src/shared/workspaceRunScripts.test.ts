import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  asSingleShellLine,
  collectWorkspaceRunScripts,
  detectNodePackageManager,
  detectPythonRunner,
  nodeRunCommand,
  scanWorkspaceRunScripts,
  type WorkspaceDirEntry
} from './workspaceRunScripts.ts'

describe('detectNodePackageManager', () => {
  it('prefers Corepack packageManager over lockfiles', () => {
    assert.equal(
      detectNodePackageManager({
        names: ['package.json', 'package-lock.json'],
        packageJson: '{"packageManager":"bun@1.2.5","scripts":{"dev":"vite"}}'
      }),
      'bun'
    )
    assert.equal(
      detectNodePackageManager({
        names: ['package.json', 'bun.lock'],
        packageJson: '{"packageManager":"pnpm@9.0.0"}'
      }),
      'pnpm'
    )
  })

  it('uses bun.lock / bun.lockb before other locks', () => {
    assert.equal(
      detectNodePackageManager({ names: ['package.json', 'bun.lock', 'package-lock.json'] }),
      'bun'
    )
    assert.equal(
      detectNodePackageManager({ names: ['package.json', 'bun.lockb'] }),
      'bun'
    )
  })

  it('does not treat bunfig.toml as a lockfile when npm/yarn/pnpm lock exists', () => {
    assert.equal(
      detectNodePackageManager({
        names: ['package.json', 'package-lock.json', 'bunfig.toml']
      }),
      'npm'
    )
    assert.equal(
      detectNodePackageManager({ names: ['package.json', 'yarn.lock', 'bunfig.toml'] }),
      'yarn'
    )
    assert.equal(
      detectNodePackageManager({ names: ['package.json', 'pnpm-lock.yaml', 'bunfig.toml'] }),
      'pnpm'
    )
  })

  it('falls back to bun when bunfig.toml is the only signal', () => {
    assert.equal(detectNodePackageManager({ names: ['package.json', 'bunfig.toml'] }), 'bun')
  })

  it('defaults to npm without lockfiles', () => {
    assert.equal(detectNodePackageManager({ names: ['package.json'] }), 'npm')
  })
})

describe('collectWorkspaceRunScripts', () => {
  it('builds bun run commands and hides npm lifecycle / paired pre/post scripts', () => {
    const scripts = collectWorkspaceRunScripts({
      names: ['package.json', 'bun.lock'],
      packageJson: JSON.stringify({
        scripts: {
          predev: 'echo pre',
          dev: 'vite',
          postdev: 'echo post',
          preinstall: 'node setup.mjs',
          postinstall: 'node fix.mjs',
          _hidden: 'secret',
          'test:unit': 'node --test',
          build: 'tsc'
        }
      })
    })
    const node = scripts.filter((s) => s.kind === 'node')
    assert.deepEqual(
      node.map((s) => s.label),
      ['dev', 'build', 'test:unit']
    )
    assert.deepEqual(
      node.map((s) => s.command),
      ['bun run dev', 'bun run build', 'bun run test:unit']
    )
    assert.equal(node[0]?.runner, 'bun')
  })

  it('quotes script names that are not bare tokens', () => {
    assert.equal(nodeRunCommand('npm', 'foo bar'), "npm run 'foo bar'")
    assert.equal(nodeRunCommand('yarn', 'lint:fix'), 'yarn lint:fix')
  })

  it('collects python / go / rust / make commands', () => {
    const scripts = collectWorkspaceRunScripts({
      names: ['pyproject.toml', 'uv.lock', 'main.py', 'tests', 'Cargo.toml', 'go.mod', 'main.go', 'Makefile'],
      pyprojectToml: `
[project.scripts]
serve = "app.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
      goMod: 'module example.com/app\n',
      hasGoMain: true,
      goCmdNames: ['worker'],
      cargoToml: `
[package]
name = "app"

[[bin]]
name = "sidecar"
`,
      makefile: `
.PHONY: all
all: build
build:
	go build .
`
    })
    assert.ok(scripts.some((s) => s.command === 'uv run python main.py'))
    assert.ok(scripts.some((s) => s.command === 'uv run serve'))
    assert.ok(scripts.some((s) => s.command === 'uv run pytest'))
    assert.ok(scripts.some((s) => s.command === 'go run .'))
    assert.ok(scripts.some((s) => s.command === 'go run ./cmd/worker'))
    assert.ok(scripts.some((s) => s.command === 'go test ./...'))
    assert.ok(scripts.some((s) => s.command === 'cargo run'))
    assert.ok(scripts.some((s) => s.command === 'cargo run --bin sidecar'))
    assert.ok(scripts.some((s) => s.command === 'make all'))
    assert.ok(scripts.some((s) => s.command === 'make build'))
  })

  it('does not treat a JS test/ folder as pytest', () => {
    const scripts = collectWorkspaceRunScripts({
      names: ['package.json', 'package-lock.json', 'test'],
      packageJson: '{"scripts":{"test":"node --test"}}'
    })
    assert.equal(
      scripts.some((s) => s.kind === 'python'),
      false
    )
    assert.ok(scripts.some((s) => s.command === 'npm run test'))
  })

  it('uses python3 when there is no uv/poetry/pipenv marker', () => {
    const scripts = collectWorkspaceRunScripts({
      names: ['main.py', 'manage.py']
    })
    assert.ok(scripts.some((s) => s.command === 'python3 main.py'))
    assert.ok(scripts.some((s) => s.command === 'python3 manage.py runserver'))
  })
})

describe('detectPythonRunner', () => {
  it('prefers uv.lock then poetry then pipenv', () => {
    assert.equal(detectPythonRunner({ names: ['uv.lock', 'pyproject.toml'] }), 'uv')
    assert.equal(
      detectPythonRunner({ names: ['pyproject.toml'], pyprojectToml: '[tool.poetry]\nname="x"\n' }),
      'poetry'
    )
    assert.equal(detectPythonRunner({ names: ['Pipfile.lock'] }), 'pipenv')
    assert.equal(detectPythonRunner({ names: ['pyproject.toml'] }), 'python')
  })
})

describe('scanWorkspaceRunScripts', () => {
  it('reads listed files and cmd/ children', async () => {
    const files: Record<string, string> = {
      '/repo/package.json': '{"scripts":{"dev":"vite"}}',
      '/repo/go.mod': 'module app\n'
    }
    const dirs: Record<string, WorkspaceDirEntry[]> = {
      '/repo': [
        { name: 'package.json', path: '/repo/package.json', isDirectory: false },
        { name: 'package-lock.json', path: '/repo/package-lock.json', isDirectory: false },
        { name: 'bunfig.toml', path: '/repo/bunfig.toml', isDirectory: false },
        { name: 'go.mod', path: '/repo/go.mod', isDirectory: false },
        { name: 'cmd', path: '/repo/cmd', isDirectory: true }
      ],
      '/repo/cmd': [{ name: 'vav', path: '/repo/cmd/vav', isDirectory: true }]
    }
    const result = await scanWorkspaceRunScripts('/repo', {
      list: async (path) => dirs[path] ?? [],
      readText: async (path) => files[path] ?? null
    })
    assert.equal(result.packageManager, 'npm')
    assert.ok(result.scripts.some((s) => s.command === 'npm run dev'))
    assert.ok(result.scripts.some((s) => s.command === 'go run ./cmd/vav'))
  })
})

describe('asSingleShellLine', () => {
  it('collapses injected newlines', () => {
    assert.equal(asSingleShellLine('npm run dev\nrm -rf /'), 'npm run dev rm -rf /')
  })
})
