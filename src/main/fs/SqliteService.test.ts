import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { inspectSqlite, isSqlitePath, querySqliteTable, closeSqlite } from './SqliteService.ts'

describe('SqliteService', () => {
  it('classifies sqlite paths', () => {
    assert.equal(isSqlitePath('/tmp/notes.db'), true)
    assert.equal(isSqlitePath('/tmp/app.sqlite3'), true)
    assert.equal(isSqlitePath('/tmp/notes.md'), false)
  })

  it('inspects tables and windowed rows without inventing SQL from the caller', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-sqlite-'))
    const path = join(dir, 'notes.db')
    try {
      execSync(
        `python3 -c ${JSON.stringify(
          `import sqlite3; c=sqlite3.connect(${JSON.stringify(path)}); c.execute('create table items(name text, qty int)'); c.execute("insert into items values ('Pens', 12)"); c.commit()`
        )}`
      )
      const info = inspectSqlite(path)
      assert.equal(info.tables.length, 1)
      assert.equal(info.tables[0]?.name, 'items')
      assert.deepEqual(info.tables[0]?.columns, ['name', 'qty'])
      assert.equal(info.tables[0]?.rowCount, 1)
      const page = querySqliteTable(path, 'items', 0, 10)
      assert.equal(page.error, undefined)
      assert.equal(page.rows[0]?.[0], 'Pens')
      const rejected = querySqliteTable(path, 'items; drop table items', 0, 10)
      assert.match(rejected.error ?? '', /Invalid table name/)
    } finally {
      closeSqlite(path)
      rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
    }
  })
})
