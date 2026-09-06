import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { SkillService } from './SkillService.ts'

describe('SkillService', () => {
  it('resolves the bundled catalog without a CJS __dirname', () => {
    const skills = new SkillService()
    const root = skills.root()
    assert.ok(root)
    assert.equal(existsSync(join(root, 'catalog.json')), true)
    const catalog = skills.catalog()
    assert.ok(catalog.skills.length > 0)
  })
})
