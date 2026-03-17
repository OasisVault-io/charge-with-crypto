import fs from 'node:fs'
import path from 'node:path'
import {
  type CollectionMap,
  type CollectionName,
  type InsertableRecord,
  type PatchRecord,
  type StoreLike,
} from '../services/shared/types'
import { randomId } from '../utils/id'
import { nowIso } from '../utils/time'

class JsonStore implements StoreLike {
  dataDir: string
  collections: CollectionName[]

  constructor(dataDir: string) {
    this.dataDir = dataDir
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
    this.ensure()
  }

  ensure() {
    fs.mkdirSync(this.dataDir, { recursive: true })
    for (const name of this.collections) {
      const file = this.filePath(name)
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]\n')
      }
    }
  }

  filePath(name: CollectionName) {
    return path.join(this.dataDir, `${name}.json`)
  }

  read<C extends CollectionName>(name: C): CollectionMap[C][] {
    return JSON.parse(
      fs.readFileSync(this.filePath(name), 'utf8'),
    ) as CollectionMap[C][]
  }

  write<C extends CollectionName>(name: C, items: CollectionMap[C][]) {
    fs.writeFileSync(this.filePath(name), `${JSON.stringify(items, null, 2)}\n`)
  }

  list<C extends CollectionName>(name: C): CollectionMap[C][] {
    return this.read(name)
  }

  getById<C extends CollectionName>(
    name: C,
    id: string,
  ): CollectionMap[C] | null {
    return this.read(name).find((item) => item.id === id) || null
  }

  insert<C extends CollectionName>(
    name: C,
    item: InsertableRecord<CollectionMap[C]>,
  ): CollectionMap[C] {
    const items = this.read(name)
    const timestamp = nowIso()
    const withMeta = {
      id: String(item.id || randomId(name)),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...item,
    } as CollectionMap[C]
    items.push(withMeta)
    this.write(name, items)
    return withMeta
  }

  update<C extends CollectionName>(
    name: C,
    id: string,
    patch: PatchRecord<CollectionMap[C]>,
  ): CollectionMap[C] | null {
    const items = this.read(name)
    const index = items.findIndex((item) => item.id === id)
    if (index === -1) return null
    const updated = {
      ...items[index],
      ...patch,
      updatedAt: nowIso(),
    } as CollectionMap[C]
    items[index] = updated
    this.write(name, items)
    return updated
  }

  find<C extends CollectionName>(
    name: C,
    predicate: (item: CollectionMap[C]) => boolean,
  ): CollectionMap[C][] {
    return this.read(name).filter(predicate)
  }

  findOne<C extends CollectionName>(
    name: C,
    predicate: (item: CollectionMap[C]) => boolean,
  ): CollectionMap[C] | null {
    return this.read(name).find(predicate) || null
  }
}

export { JsonStore }
