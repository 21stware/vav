/**
 * `node:sqlite` shim backed by `bun:sqlite`, so the VAV CLIs
 * (vav-server / vav-board / vav-tui) can run under `bun` — Node's built-in
 * `node:sqlite` (DatabaseSync) has no equivalent in bun.
 *
 * Only the surface the codebase actually uses is implemented:
 *   new DatabaseSync(path, { readOnly? })
 *   db.prepare(sql) -> { all(...p), get(...p), run(...p) }
 *   db.exec(sql)
 *   db.close()
 *
 * Injected via a bun plugin (see scripts/bun/preload.ts + bunfig.toml).
 */
import { Database } from 'bun:sqlite'

export class DatabaseSync {
  #db: Database

  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.#db = opts.readOnly
      ? new Database(path, { readonly: true })
      : new Database(path, { create: true, readwrite: true })
  }

  prepare(sql: string): import('bun:sqlite').Statement {
    // bun's Statement already exposes .all/.get/.run with positional params.
    return this.#db.prepare(sql)
  }

  exec(sql: string): void {
    this.#db.exec(sql)
  }

  close(): void {
    this.#db.close()
  }
}

export default { DatabaseSync }
