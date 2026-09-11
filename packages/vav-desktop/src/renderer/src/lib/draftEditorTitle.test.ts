import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isDraftDbTitle, isDraftScheduledTitle } from './draftEditorTitle.ts'

describe('draft editor titles', () => {
  it('treats empty, current, and legacy scheduled titles as drafts', () => {
    assert.equal(isDraftScheduledTitle('', 'Untitled-scheduled-task'), true)
    assert.equal(isDraftScheduledTitle('Untitled-scheduled-task', 'Untitled-scheduled-task'), true)
    assert.equal(isDraftScheduledTitle('A-new-scheduled-task', 'Untitled-scheduled-task'), true)
    assert.equal(isDraftScheduledTitle('Scheduled task', 'Untitled-scheduled-task'), true)
    assert.equal(isDraftScheduledTitle('定时任务', 'Untitled-scheduled-task'), true)
    assert.equal(isDraftScheduledTitle('Nightly deploy', 'Untitled-scheduled-task'), false)
  })

  it('treats empty, current, and legacy db titles as drafts', () => {
    assert.equal(isDraftDbTitle('', 'Untitled-db-connection'), true)
    assert.equal(isDraftDbTitle('Untitled-db-connection', 'Untitled-db-connection'), true)
    assert.equal(isDraftDbTitle('A-new-db-connection', 'Untitled-db-connection'), true)
    assert.equal(isDraftDbTitle('Database', 'Untitled-db-connection'), true)
    assert.equal(isDraftDbTitle('数据库连接', 'Untitled-db-connection'), true)
    assert.equal(isDraftDbTitle('Prod replica', 'Untitled-db-connection'), false)
  })
})
