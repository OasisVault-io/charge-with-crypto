import fs from 'node:fs'
import { desc, eq } from 'drizzle-orm'
import { createDrizzleDb, schema } from '../db/client'
import { type CollectionName as DbCollectionName } from '../db/schema'
import {
  type CollectionMap,
  type CollectionName,
  type InsertableRecord,
  type PatchRecord,
  type StoreLike,
} from '../services/shared/types'
import { randomId } from '../utils/id'
import { nowIso } from '../utils/time'
import { JsonStore } from './jsonStore'

type TableMap = typeof schema.collectionTables
type JsonRow = { json: string }

class SqliteStore implements StoreLike {
  dataDir: string
  collections: CollectionName[]
  sqlite: ReturnType<typeof createDrizzleDb>['sqlite'] | null
  db: ReturnType<typeof createDrizzleDb>['db'] | null
  tables: TableMap
  fallback: JsonStore | null

  constructor(dataDir: string) {
    this.dataDir = dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    this.collections = [
      'merchants',
      'products',
      'checkouts',
      'quotes',
      'payments',
      'events',
      'webhook_deliveries',
      'idempotency_keys',
      'counters',
    ]
    this.sqlite = null
    this.db = null
    this.tables = schema.collectionTables
    this.fallback = null
    try {
      const { sqlite, db } = createDrizzleDb(dataDir)
      this.sqlite = sqlite
      this.db = db
      this.ensure()
    } catch (error) {
      console.error('Failed to initialize SQLite store', error)
      this.fallback = new JsonStore(dataDir)
    }
  }

  ensure() {
    if (!this.sqlite) return
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('synchronous = NORMAL')
    for (const name of this.collections) {
      this.sqlite.exec(
        `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL);`,
      )
      this.sqlite.exec(
        `CREATE INDEX IF NOT EXISTS idx_${name}_created_at ON ${name} (created_at DESC);`,
      )
    }
  }

  table<C extends CollectionName>(name: C) {
    const table = this.tables[name as DbCollectionName]
    if (!table) throw new Error(`unknown collection: ${name}`)
    return table
  }

  rowToItem<C extends CollectionName>(
    row: JsonRow | undefined,
  ): CollectionMap[C] | null {
    if (!row) return null
    return JSON.parse(row.json) as CollectionMap[C]
  }

  list<C extends CollectionName>(name: C): CollectionMap[C][] {
    if (this.fallback) return this.fallback.list(name)
    const table = this.table(name)
    const rows = this.db!.select({ json: table.json })
      .from(table)
      .orderBy(desc(table.createdAt))
      .all()
    return rows.map((row) => JSON.parse(row.json) as CollectionMap[C])
  }

  getById<C extends CollectionName>(
    name: C,
    id: string,
  ): CollectionMap[C] | null {
    if (this.fallback) return this.fallback.getById(name, id)
    const table = this.table(name)
    const row = this.db!.select({ json: table.json })
      .from(table)
      .where(eq(table.id, String(id)))
      .get()
    return this.rowToItem<C>(row)
  }

  delete<C extends CollectionName>(name: C, id: string): boolean {
    if (this.fallback) return this.fallback.delete(name, id)
    const table = this.table(name)
    const current = this.getById(name, id)
    if (!current) return false
    this.db!.delete(table).where(eq(table.id, String(id))).run()
    return true
  }

  insert<C extends CollectionName>(
    name: C,
    item: InsertableRecord<CollectionMap[C]>,
  ): CollectionMap[C] {
    if (this.fallback) return this.fallback.insert(name, item)
    const table = this.table(name)
    const timestamp = nowIso()
    const withMeta = {
      id: String(item.id || randomId(name)),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...item,
    } as CollectionMap[C]
    this.db!.insert(table)
      .values({
        id: withMeta.id,
        createdAt: String(withMeta.createdAt || timestamp),
        updatedAt: String(withMeta.updatedAt || timestamp),
        json: JSON.stringify(withMeta),
      })
      .run()
    return withMeta
  }

  update<C extends CollectionName>(
    name: C,
    id: string,
    patch: PatchRecord<CollectionMap[C]>,
  ): CollectionMap[C] | null {
    if (this.fallback) return this.fallback.update(name, id, patch)
    const table = this.table(name)
    const current = this.getById(name, id)
    if (!current) return null
    const updated = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    } as CollectionMap[C]
    this.db!.update(table)
      .set({
        updatedAt: String(updated.updatedAt || nowIso()),
        json: JSON.stringify(updated),
      })
      .where(eq(table.id, String(id)))
      .run()
    return updated
  }

  find<C extends CollectionName>(
    name: C,
    predicate: (item: CollectionMap[C]) => boolean,
  ): CollectionMap[C][] {
    if (this.fallback) return this.fallback.find(name, predicate)
    return this.list(name).filter(predicate)
  }

  findOne<C extends CollectionName>(
    name: C,
    predicate: (item: CollectionMap[C]) => boolean,
  ): CollectionMap[C] | null {
    if (this.fallback) return this.fallback.findOne(name, predicate)
    return this.list(name).find(predicate) || null
  }
}

export { SqliteStore }
