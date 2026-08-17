import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSupabaseWorkspace,
  mapSupabaseFunctionStatus,
  mapSupabaseProjectStatus,
  mergeSupabaseFunctions,
  supabaseDashboardFunctionUrl,
  supabaseFunctionInvokeUrl,
  type SupabaseLocalFunction,
  type SupabaseRemoteFunction
} from './supabase.ts'
import {
  extractSupabaseRefFromUrl,
  isSupabaseConfigName,
  isSupabaseEnvName,
  parseSupabaseEnvRefs,
  parseSupabaseFunctionMeta,
  parseSupabaseProjectId,
  parseSupabaseProjectRefFile
} from './supabaseConfig.ts'

describe('supabaseConfig', () => {
  it('recognizes config and env file names', () => {
    assert.equal(isSupabaseConfigName('config.toml'), true)
    assert.equal(isSupabaseConfigName('wrangler.toml'), false)
    assert.equal(isSupabaseEnvName('.env'), true)
    assert.equal(isSupabaseEnvName('.env.local'), true)
    assert.equal(isSupabaseEnvName('.env.example'), false)
  })

  it('reads project_id from config.toml', () => {
    const src = `
# A string used to distinguish different Supabase projects on the same host
project_id = "notes-app"

[api]
enabled = true
`
    assert.equal(parseSupabaseProjectId(src), 'notes-app')
  })

  it('reads function slugs and verify_jwt', () => {
    const src = `
[functions.hello]
verify_jwt = false

[functions.ingest]
verify_jwt = true
`
    const meta = parseSupabaseFunctionMeta(src)
    assert.equal(meta.hello?.verifyJwt, false)
    assert.equal(meta.ingest?.verifyJwt, true)
  })

  it('extracts a project ref from hosted URLs and bare refs', () => {
    assert.equal(
      extractSupabaseRefFromUrl('https://abcdefghijklmnopqr.supabase.co'),
      'abcdefghijklmnopqr'
    )
    assert.equal(
      extractSupabaseRefFromUrl('"https://abcdefghijklmnopqr.supabase.co/rest/v1"'),
      'abcdefghijklmnopqr'
    )
    assert.equal(extractSupabaseRefFromUrl('abcdefghijklmnopqr'), 'abcdefghijklmnopqr')
    assert.equal(extractSupabaseRefFromUrl('not-a-ref'), null)
  })

  it('parses env files and project-ref files', () => {
    const env = `
# comment
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqr.supabase.co
SUPABASE_ANON_KEY=secret
VITE_SUPABASE_URL="https://abcdefghijklmnopqr.supabase.co"
`
    assert.deepEqual(parseSupabaseEnvRefs(env), ['abcdefghijklmnopqr'])
    assert.equal(parseSupabaseProjectRefFile('abcdefghijklmnopqr\n'), 'abcdefghijklmnopqr')
  })
})

describe('supabase merge', () => {
  it('maps platform statuses', () => {
    assert.equal(mapSupabaseProjectStatus('ACTIVE_HEALTHY'), 'healthy')
    assert.equal(mapSupabaseProjectStatus('INACTIVE'), 'paused')
    assert.equal(mapSupabaseFunctionStatus('ACTIVE'), 'active')
    assert.equal(mapSupabaseFunctionStatus('ACTIVE_UNHEALTHY'), 'unhealthy')
  })

  it('merges local and remote functions by slug', () => {
    const local: SupabaseLocalFunction[] = [
      {
        slug: 'hello',
        path: '/repo/supabase/functions/hello/index.ts',
        relativePath: 'supabase/functions/hello/index.ts',
        verifyJwt: false
      },
      {
        slug: 'draft',
        path: '/repo/supabase/functions/draft/index.ts',
        relativePath: 'supabase/functions/draft/index.ts',
        verifyJwt: null
      }
    ]
    const remote: SupabaseRemoteFunction[] = [
      {
        id: '1',
        slug: 'hello',
        name: 'hello',
        status: 'active',
        version: 3,
        createdAt: null,
        updatedAt: '2026-08-01T00:00:00Z',
        verifyJwt: true,
        importMap: false,
        entrypoint: 'index.ts'
      },
      {
        id: '2',
        slug: 'mailer',
        name: 'mailer',
        status: 'unhealthy',
        version: 1,
        createdAt: null,
        updatedAt: null,
        verifyJwt: true,
        importMap: null,
        entrypoint: null
      }
    ]
    const merged = mergeSupabaseFunctions(local, remote, 'abcdefghijklmnopqr')
    assert.deepEqual(
      merged.map((row) => row.slug),
      ['draft', 'hello', 'mailer']
    )
    const hello = merged.find((row) => row.slug === 'hello')!
    assert.equal(hello.local, true)
    assert.equal(hello.remote, true)
    assert.equal(hello.status, 'active')
    assert.equal(hello.version, 3)
    assert.equal(hello.invokeUrl, supabaseFunctionInvokeUrl('abcdefghijklmnopqr', 'hello'))
    const draft = merged.find((row) => row.slug === 'draft')!
    assert.equal(draft.status, 'local')
    assert.equal(draft.remote, false)
    const mailer = merged.find((row) => row.slug === 'mailer')!
    assert.equal(mailer.local, false)
    assert.equal(mailer.status, 'unhealthy')
  })

  it('treats config, ref, or local functions as a supabase workspace', () => {
    assert.equal(
      isSupabaseWorkspace({ config: null, projectRef: null, localFunctions: [] }),
      false
    )
    assert.equal(
      isSupabaseWorkspace({
        config: { path: '/x', relativePath: 'supabase/config.toml', projectId: 'app' },
        projectRef: null,
        localFunctions: []
      }),
      true
    )
    assert.equal(
      supabaseDashboardFunctionUrl('abcdefghijklmnopqr', 'hello'),
      'https://supabase.com/dashboard/project/abcdefghijklmnopqr/functions/hello'
    )
  })
})
