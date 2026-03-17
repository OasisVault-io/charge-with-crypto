import path from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'

export function createDatabasePath(dataDir: string) {
  return path.join(dataDir, 'chaincart.sqlite')
}

export function createBetterSqliteDb(dataDir: string) {
  return new Database(createDatabasePath(dataDir))
}

export function createDrizzleDb(dataDir: string) {
  const sqlite = createBetterSqliteDb(dataDir)
  const db = drizzle(sqlite, { schema })
  return { sqlite, db }
}

export { schema }
