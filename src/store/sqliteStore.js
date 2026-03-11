const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomId } = require('../utils/id');
const { nowIso } = require('../utils/time');

class SqliteStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'chaincart.sqlite');
    this.db = new DatabaseSync(this.file);
    this.collections = ['merchants', 'checkouts', 'quotes', 'payments', 'events', 'webhook_deliveries', 'idempotency_keys', 'counters'];
    this.ensure();
  }

  ensure() {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    for (const name of this.collections) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL);`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${name}_created_at ON ${name} (created_at DESC);`);
    }
  }

  rowToItem(row) {
    if (!row) return null;
    return JSON.parse(row.json);
  }

  list(name) {
    const rows = this.db.prepare(`SELECT json FROM ${name} ORDER BY created_at DESC`).all();
    return rows.map((row) => JSON.parse(row.json));
  }

  getById(name, id) {
    const row = this.db.prepare(`SELECT json FROM ${name} WHERE id = ?`).get(String(id));
    return this.rowToItem(row);
  }

  insert(name, item) {
    const timestamp = nowIso();
    const withMeta = { id: item.id || randomId(name), createdAt: timestamp, updatedAt: timestamp, ...item };
    this.db.prepare(`INSERT INTO ${name} (id, created_at, updated_at, json) VALUES (?, ?, ?, ?)`)
      .run(withMeta.id, withMeta.createdAt, withMeta.updatedAt, JSON.stringify(withMeta));
    return withMeta;
  }

  update(name, id, patch) {
    const current = this.getById(name, id);
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: nowIso() };
    this.db.prepare(`UPDATE ${name} SET updated_at = ?, json = ? WHERE id = ?`)
      .run(updated.updatedAt, JSON.stringify(updated), id);
    return updated;
  }

  find(name, predicate) {
    return this.list(name).filter(predicate);
  }

  findOne(name, predicate) {
    return this.list(name).find(predicate) || null;
  }
}

module.exports = { SqliteStore };
