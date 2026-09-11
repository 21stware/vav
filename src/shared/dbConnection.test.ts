import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampDbPort,
  dbConnectionTitle,
  defaultDbConnectionInput,
  isDbDriver,
  isReadOnlySql,
  isSingleSqlStatement
} from './dbConnection.ts'

describe('dbConnection helpers', () => {
  it('accepts known drivers and defaults postgres to 5432', () => {
    assert.equal(isDbDriver('postgres'), true)
    assert.equal(isDbDriver('mysql'), true)
    assert.equal(isDbDriver('oracle'), false)
    assert.equal(defaultDbConnectionInput().port, 5432)
    assert.equal(clampDbPort(0), 5432)
    assert.equal(clampDbPort(99999), 65535)
  })

  it('titles from database@host when the stored title is empty', () => {
    assert.equal(
      dbConnectionTitle({ title: '', database: 'app', host: 'db.internal', driver: 'postgres' }),
      'app@db.internal'
    )
    assert.equal(
      dbConnectionTitle({ title: 'Prod', database: 'app', host: 'db.internal', driver: 'postgres' }),
      'Prod'
    )
  })

  it('allows only a single read-only statement', () => {
    assert.equal(isReadOnlySql('SELECT 1'), true)
    assert.equal(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'), true)
    assert.equal(isReadOnlySql('EXPLAIN SELECT 1'), true)
    assert.equal(isReadOnlySql('INSERT INTO t VALUES (1)'), false)
    assert.equal(isReadOnlySql('DROP TABLE t'), false)
    assert.equal(isSingleSqlStatement('SELECT 1'), true)
    assert.equal(isSingleSqlStatement('SELECT 1; SELECT 2'), false)
    assert.equal(isSingleSqlStatement('SELECT 1;'), true)
  })
})
