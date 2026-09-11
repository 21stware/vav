import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampDbPort,
  dbConnectionSubtitle,
  dbConnectionTitle,
  dbUrlPlaceholder,
  defaultDbConnectionInput,
  formatDbUrl,
  formatPostgresUrl,
  isDbDriver,
  isDbDriverImplemented,
  isReadOnlySql,
  isSingleSqlStatement,
  parseDbUrl,
  parsePostgresUrl,
  postgresUrlWithPassword,
  setPostgresUrlSsl
} from './dbConnection.ts'

describe('dbConnection helpers', () => {
  it('accepts known drivers and defaults postgres to 5432', () => {
    assert.equal(isDbDriver('postgres'), true)
    assert.equal(isDbDriver('mysql'), true)
    assert.equal(isDbDriver('clickhouse'), true)
    assert.equal(isDbDriver('bigquery'), true)
    assert.equal(isDbDriver('duckdb'), true)
    assert.equal(isDbDriver('oracle'), false)
    assert.equal(isDbDriverImplemented('mysql'), true)
    assert.equal(isDbDriverImplemented('sqlite'), false)
    assert.equal(defaultDbConnectionInput().port, 5432)
    assert.equal(clampDbPort(0), 5432)
    assert.equal(clampDbPort(0, 'mysql'), 3306)
    assert.equal(clampDbPort(99999), 65535)
    assert.equal(clampDbPort(99, 'duckdb'), 0)
  })

  it('titles from database@host when the stored title is empty', () => {
    assert.equal(
      dbConnectionTitle({ title: '', database: 'app', host: 'db.internal', driver: 'postgres', user: '' }),
      'app@db.internal'
    )
    assert.equal(
      dbConnectionTitle({ title: 'Prod', database: 'app', host: 'db.internal', driver: 'postgres', user: '' }),
      'Prod'
    )
    assert.equal(
      dbConnectionTitle({
        title: '',
        database: '/tmp/analytics.duckdb',
        host: '',
        driver: 'duckdb',
        user: ''
      }),
      'analytics.duckdb'
    )
    assert.equal(
      dbConnectionTitle({ title: '', database: 'proj', host: '', driver: 'bigquery', user: 'sales' }),
      'sales@proj'
    )
    assert.equal(
      dbConnectionSubtitle({ driver: 'bigquery', host: 'US', database: 'proj', user: 'sales' }),
      'proj / sales'
    )
  })

  it('allows only a single read-only statement', () => {
    assert.equal(isReadOnlySql('SELECT 1'), true)
    assert.equal(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'), true)
    assert.equal(isReadOnlySql('EXPLAIN SELECT 1'), true)
    assert.equal(isReadOnlySql('PRAGMA table_info(t)'), true)
    assert.equal(isReadOnlySql('INSERT INTO t VALUES (1)'), false)
    assert.equal(isReadOnlySql('DROP TABLE t'), false)
    assert.equal(isSingleSqlStatement('SELECT 1'), true)
    assert.equal(isSingleSqlStatement('SELECT 1; SELECT 2'), false)
    assert.equal(isSingleSqlStatement('SELECT 1;'), true)
  })

  it('parses and redacts a postgres URL, then injects the vault password', () => {
    const parsed = parsePostgresUrl(
      'postgresql://vav:s3cret@db.internal:6543/app?sslmode=require'
    )
    assert.ok(parsed)
    assert.equal(parsed.host, 'db.internal')
    assert.equal(parsed.port, 6543)
    assert.equal(parsed.database, 'app')
    assert.equal(parsed.user, 'vav')
    assert.equal(parsed.password, 's3cret')
    assert.equal(parsed.ssl, true)
    assert.equal(parsed.url.includes('s3cret'), false)
    assert.equal(parsePostgresUrl('http://db.internal/app'), null)
    assert.equal(parsePostgresUrl('postgresql://'), null)
    const composed = formatPostgresUrl({
      host: 'localhost',
      port: 5432,
      database: 'app',
      user: 'vav',
      ssl: true
    })
    assert.equal(composed.startsWith('postgresql://'), true)
    assert.ok(composed.includes('sslmode=require'))
    assert.equal(setPostgresUrlSsl(composed, false).includes('sslmode'), false)
    const withPw = postgresUrlWithPassword('postgresql://vav@db.internal:5432/app', 's3cret')
    assert.ok(withPw.includes('s3cret'))
  })

  it('parses mysql, clickhouse, bigquery, and duckdb URLs', () => {
    const mysql = parseDbUrl('mysql://root:pw@127.0.0.1:3307/shop?ssl=true')
    assert.ok(mysql)
    assert.equal(mysql.driver, 'mysql')
    assert.equal(mysql.host, '127.0.0.1')
    assert.equal(mysql.port, 3307)
    assert.equal(mysql.database, 'shop')
    assert.equal(mysql.ssl, true)
    assert.equal(mysql.url.includes('pw'), false)

    const ch = parseDbUrl('clickhouse://default:pw@ch.internal:8443/analytics', 'clickhouse')
    assert.ok(ch)
    assert.equal(ch.driver, 'clickhouse')
    assert.equal(ch.host, 'ch.internal')
    assert.equal(ch.port, 8443)
    assert.equal(ch.database, 'analytics')

    const httpsCh = parseDbUrl('https://default@ch.cloud:8443/analytics', 'clickhouse')
    assert.ok(httpsCh)
    assert.equal(httpsCh.ssl, true)
    assert.equal(httpsCh.database, 'analytics')

    const bq = parseDbUrl('bigquery://my-proj/sales?location=EU')
    assert.ok(bq)
    assert.equal(bq.driver, 'bigquery')
    assert.equal(bq.database, 'my-proj')
    assert.equal(bq.user, 'sales')
    assert.equal(bq.host, 'EU')

    const duck = parseDbUrl('/tmp/local.duckdb', 'duckdb')
    assert.ok(duck)
    assert.equal(duck.driver, 'duckdb')
    assert.equal(duck.database, '/tmp/local.duckdb')

    const duckUrl = parseDbUrl('duckdb:///tmp/local.duckdb')
    assert.ok(duckUrl)
    assert.equal(duckUrl.database, '/tmp/local.duckdb')

    assert.equal(dbUrlPlaceholder('mysql').startsWith('mysql://'), true)
    const formatted = formatDbUrl({
      driver: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'shop',
      user: 'root',
      ssl: false
    })
    assert.equal(formatted.startsWith('mysql://'), true)
  })
})
