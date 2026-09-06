import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isVercelConfigName, parseVercelJsonName, parseVercelProjectJson } from './vercelConfig.ts'
import { mapVercelReadyState, vercelDashboardUrl } from './vercel.ts'

describe('vercelConfig', () => {
  it('recognizes vercel.json', () => {
    assert.equal(isVercelConfigName('vercel.json'), true)
    assert.equal(isVercelConfigName('package.json'), false)
  })

  it('parses .vercel/project.json', () => {
    const parsed = parseVercelProjectJson(
      '{"projectId":"prj_1","orgId":"team_1","projectName":"site"}'
    )
    assert.deepEqual(parsed, { projectId: 'prj_1', orgId: 'team_1', projectName: 'site' })
    assert.deepEqual(parseVercelProjectJson('not-json'), {
      projectId: null,
      orgId: null,
      projectName: null
    })
  })

  it('reads a project name from vercel.json', () => {
    assert.equal(parseVercelJsonName('{"name":"docs"}'), 'docs')
    assert.equal(parseVercelJsonName('{}'), null)
  })
})

describe('vercel status helpers', () => {
  it('maps ready states and dashboard URLs', () => {
    assert.equal(mapVercelReadyState('READY'), 'ready')
    assert.equal(mapVercelReadyState('ERROR'), 'error')
    assert.equal(vercelDashboardUrl('team_1', 'site'), 'https://vercel.com/team_1/site')
    assert.equal(vercelDashboardUrl(null, null), null)
  })
})
