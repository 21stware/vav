import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isVercelConfigName, isVercelProjectFile, parseVercelProjectName } from './vercelConfig.ts'

describe('vercelConfig', () => {
  it('recognizes vercel.json and .vercel/project.json', () => {
    assert.equal(isVercelConfigName('vercel.json'), true)
    assert.equal(isVercelProjectFile('.vercel/project.json'), true)
    assert.equal(isVercelProjectFile('apps/web/.vercel/project.json'), true)
    assert.equal(isVercelProjectFile('package.json'), false)
  })

  it('reads a project name from JSON', () => {
    assert.equal(parseVercelProjectName('{"name":"docs"}'), 'docs')
    assert.equal(parseVercelProjectName('{"projectId":"prj_1"}'), 'prj_1')
    assert.equal(parseVercelProjectName('not-json'), null)
  })
})
