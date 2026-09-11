import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblePostgresSchema,
  qualifyPgTableName,
  resolvePgTableTotal,
  splitPgTableName,
  withTimeout
} from './postgresSchema.ts'

describe('postgresSchema', () => {
  it('qualifies non-public schemas and splits them back', () => {
    assert.equal(qualifyPgTableName('public', 'rna'), 'rna')
    assert.equal(qualifyPgTableName('auth', 'users'), 'auth.users')
    assert.deepEqual(splitPgTableName('rna'), { schema: 'public', name: 'rna' })
    assert.deepEqual(splitPgTableName('auth.users'), { schema: 'auth', name: 'users' })
  })

  it('assembles catalog rows without requiring per-table counts', () => {
    const info = assemblePostgresSchema(
      [
        { schema: 'public', name: 'rna', estimate: 12 },
        { schema: 'auth', name: 'users', estimate: -1 }
      ],
      [
        { schema: 'public', name: 'rna', col: 'id' },
        { schema: 'public', name: 'rna', col: 'seq' },
        { schema: 'auth', name: 'users', col: 'email' }
      ]
    )
    assert.deepEqual(info.tables, [
      { name: 'rna', columns: ['id', 'seq'], rowCount: 12 },
      { name: 'auth.users', columns: ['email'], rowCount: 0 }
    ])
  })

  it('lists tables when column metadata is omitted', () => {
    const info = assemblePostgresSchema([{ schema: 'rnacen', name: 'xref', estimate: 99 }])
    assert.deepEqual(info.tables, [{ name: 'rnacen.xref', columns: [], rowCount: 99 }])
  })

  it('rejects a stalled catalog read', async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => undefined), 10, 'Schema'),
      /Schema timed out/
    )
  })

  it('keeps paging when a full window comes back and the estimate is stale', () => {
    assert.equal(resolvePgTableTotal({ offset: 0, limit: 500, rowCount: 20, estimate: 20 }), 20)
    assert.equal(resolvePgTableTotal({ offset: 0, limit: 500, rowCount: 500, estimate: 12 }), 501)
    assert.equal(resolvePgTableTotal({ offset: 500, limit: 500, rowCount: 500, estimate: 4000 }), 4000)
  })
})
