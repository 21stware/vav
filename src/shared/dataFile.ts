/**
 * Local tabular / database files that belong in Data (not Storage).
 * Agent analysis uses `sql_query` (DuckDB) on these paths.
 */
export const DATA_FILE_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.parquet',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.duckdb'
] as const

export type DataFileFormat = 'csv' | 'tsv' | 'parquet' | 'sqlite' | 'duckdb'

export function extOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

export function dataFileFormat(path: string): DataFileFormat | null {
  switch (extOf(path)) {
    case '.csv':
      return 'csv'
    case '.tsv':
      return 'tsv'
    case '.parquet':
      return 'parquet'
    case '.db':
    case '.sqlite':
    case '.sqlite3':
      return 'sqlite'
    case '.duckdb':
      return 'duckdb'
    default:
      return null
  }
}

export function isDataFilePath(path: string): boolean {
  return dataFileFormat(path) !== null
}

export function dataFileTitle(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  return base.trim() || path
}
