// @ts-nocheck
import fs from 'node:fs'
import { desc, eq } from 'drizzle-orm'

import { createDrizzleDb, schema } from '../db/client'
import { randomId } from '../utils/id'
import { nowIso } from '../utils/time'

class SqliteStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.collections = ['merchants', 'products', 'checkouts', 'quotes', 'payments', 'events', 'webhook_deliveries', 'idempotency_keys', 'counters'];
    const { sqlite, db } = createDrizzleDb(dataDir);
    this.sqlite = sqlite;
    this.db = db;
    this.tables = schema.collectionTables;
    this.ensure();
  }

  ensure() {
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = NORMAL');
    for (const name of this.collections) {
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL);`);
      this.sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${name}_created_at ON ${name} (created_at DESC);`);
    }
  }

  table(name) {
    const table = this.tables[name];
    if (!table) throw new Error(`unknown collection: ${name}`);
    return table;
  }

  rowToItem(row) {
    if (!row) return null;
    return JSON.parse(row.json);
  }

  list(name) {
    const table = this.table(name);
    const rows = this.db.select({ json: table.json }).from(table).orderBy(desc(table.createdAt)).all();
    return rows.map((row) => JSON.parse(row.json));
  }

  getById(name, id) {
    const table = this.table(name);
    const row = this.db.select({ json: table.json }).from(table).where(eq(table.id, String(id))).get();
    return this.rowToItem(row);
  }

  insert(name, item) {
    const table = this.table(name);
    const timestamp = nowIso();
    const withMeta = { id: item.id || randomId(name), createdAt: timestamp, updatedAt: timestamp, ...item };
    this.db.insert(table).values({
      id: withMeta.id,
      createdAt: withMeta.createdAt,
      updatedAt: withMeta.updatedAt,
      json: JSON.stringify(withMeta)
    }).run();
    return withMeta;
  }

  update(name, id, patch) {
    const table = this.table(name);
    const current = this.getById(name, id);
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: nowIso() };
    this.db.update(table)
      .set({ updatedAt: updated.updatedAt, json: JSON.stringify(updated) })
      .where(eq(table.id, String(id)))
      .run();
    return updated;
  }

  find(name, predicate) {
    return this.list(name).filter(predicate);
  }

  findOne(name, predicate) {
    return this.list(name).find(predicate) || null;
  }
}

export { SqliteStore }
