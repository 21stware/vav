import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblePostgresSchema,
  PG_SCHEMA_COLUMNS_SQL,
  PG_SCHEMA_TABLES_SQL
} from './postgresSchema.ts'

const LIVE_URL = 'postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs'

describe('postgresSchema live', () => {
  it('reads the public RNAcentral catalog without COUNT(*)', async () => {
    const { Client } = await import('pg')
    const client = new Client({
      connectionString: LIVE_URL,
      connectionTimeoutMillis: 8000,
      statement_timeout: 12_000
    })
    try {
      await client.connect()
    } catch (err) {
      console.warn('skip live PG catalog: %s', (err as Error).message)
      return
    }
    try {
      const listed = await client.query<{ nsp: string; name: string; estimate: string }>(
        PG_SCHEMA_TABLES_SQL
      )
      const columns = await client.query<{ nsp: string; name: string; col: string }>(
        PG_SCHEMA_COLUMNS_SQL
      )
      const info = assemblePostgresSchema(
        listed.rows.map((item) => ({
          schema: item.nsp,
          name: item.name,
          estimate: Number(item.estimate ?? 0)
        })),
        columns.rows.map((item) => ({ schema: item.nsp, name: item.name, col: item.col }))
      )
      assert.ok(info.tables.length > 0, 'expected tables from RNAcentral')
      assert.ok(
        info.tables.some((table) => table.columns.length > 0),
        'expected at least one table with columns'
      )
    } finally {
      await client.end().catch(() => undefined)
    }
  })
})
