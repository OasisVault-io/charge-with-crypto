import { sql } from 'drizzle-orm'
import { text, sqliteTable } from 'drizzle-orm/sqlite-core'

function jsonCollectionTable(name: string) {
  return sqliteTable(name, {
    id: text('id').primaryKey(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    json: text('json').notNull(),
  })
}

export const merchants = jsonCollectionTable('merchants')
export const products = jsonCollectionTable('products')
export const checkouts = jsonCollectionTable('checkouts')
export const quotes = jsonCollectionTable('quotes')
export const payments = jsonCollectionTable('payments')
export const events = jsonCollectionTable('events')
export const webhookDeliveries = jsonCollectionTable('webhook_deliveries')
export const idempotencyKeys = jsonCollectionTable('idempotency_keys')
export const counters = jsonCollectionTable('counters')

export const collectionTables = {
  merchants,
  products,
  checkouts,
  quotes,
  payments,
  events,
  webhook_deliveries: webhookDeliveries,
  idempotency_keys: idempotencyKeys,
  counters,
} as const

export type CollectionName = keyof typeof collectionTables
