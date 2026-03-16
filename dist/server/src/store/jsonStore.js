"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const { randomId } = require('../utils/id');
const { nowIso } = require('../utils/time');
class JsonStore {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.collections = ['merchants', 'products', 'checkouts', 'quotes', 'payments', 'events', 'webhook_deliveries'];
        this.ensure();
    }
    ensure() {
        fs.mkdirSync(this.dataDir, { recursive: true });
        for (const name of this.collections) {
            const file = this.filePath(name);
            if (!fs.existsSync(file)) {
                fs.writeFileSync(file, '[]\n');
            }
        }
    }
    filePath(name) {
        return path.join(this.dataDir, `${name}.json`);
    }
    read(name) {
        return JSON.parse(fs.readFileSync(this.filePath(name), 'utf8'));
    }
    write(name, items) {
        fs.writeFileSync(this.filePath(name), `${JSON.stringify(items, null, 2)}\n`);
    }
    list(name) {
        return this.read(name);
    }
    getById(name, id) {
        return this.read(name).find((x) => x.id === id) || null;
    }
    insert(name, item) {
        const items = this.read(name);
        const withMeta = { id: item.id || randomId(name), createdAt: nowIso(), updatedAt: nowIso(), ...item };
        items.push(withMeta);
        this.write(name, items);
        return withMeta;
    }
    update(name, id, patch) {
        const items = this.read(name);
        const index = items.findIndex((x) => x.id === id);
        if (index === -1)
            return null;
        const updated = { ...items[index], ...patch, updatedAt: nowIso() };
        items[index] = updated;
        this.write(name, items);
        return updated;
    }
    find(name, predicate) {
        return this.read(name).filter(predicate);
    }
}
module.exports = { JsonStore };
