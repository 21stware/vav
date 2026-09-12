import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dbEditorTitlePatch,
  dbEditorTitleValue,
  isDraftDbConnection,
  isDraftDbTitle,
  isDraftScheduledTitle
} from './draftEditorTitle.ts'

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

  it('shows the auto db title instead of Untitled when editing a draft name', () => {
    assert.equal(
      dbEditorTitleValue('', 'Untitled-db-connection', 'pfmegrnargs@localhost'),
      'pfmegrnargs@localhost'
    )
    assert.equal(
      dbEditorTitleValue('Untitled-db-connection', 'Untitled-db-connection', 'app@db'),
      'app@db'
    )
    assert.equal(
      dbEditorTitleValue('Analytics', 'Untitled-db-connection', 'app@db'),
      'Analytics'
    )
    assert.equal(dbEditorTitlePatch('pfmegrnargs@localhost', 'Untitled-db-connection', 'pfmegrnargs@localhost'), '')
    assert.equal(dbEditorTitlePatch('Untitled-db-connection', 'Untitled-db-connection', 'app@db'), '')
    assert.equal(dbEditorTitlePatch('Analytics', 'Untitled-db-connection', 'app@db'), 'Analytics')
  })

  it('hides empty untitled db connections minted for the create form', () => {
    const untitled = 'Untitled-db-connection'
    assert.equal(
      isDraftDbConnection(
        { title: untitled, database: '', user: '', lastStatus: null },
        untitled
      ),
      true
    )
    assert.equal(
      isDraftDbConnection(
        { title: untitled, database: 'app', user: '', lastStatus: null },
        untitled
      ),
      false
    )
    assert.equal(
      isDraftDbConnection(
        { title: untitled, database: '', user: '', lastStatus: 'ok' },
        untitled
      ),
      false
    )
  })
})
