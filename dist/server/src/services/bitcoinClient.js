"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
class BitcoinClient {
    constructor({ baseUrl, fetchImpl = fetch }) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.fetchImpl = fetchImpl;
    }
    async getAddress(address) {
        return this.fetchJson(`/address/${encodeURIComponent(address)}`);
    }
    async getAddressTxs(address) {
        return this.fetchJson(`/address/${encodeURIComponent(address)}/txs`);
    }
    async getTransaction(txid) {
        return this.fetchJson(`/tx/${encodeURIComponent(txid)}`);
    }
    async getTipHeight() {
        const response = await this.fetchImpl(`${this.baseUrl}/blocks/tip/height`, { headers: { accept: 'text/plain' } });
        if (!response.ok)
            throw new Error(`bitcoin_http_${response.status}`);
        const value = Number(await response.text());
        if (!Number.isInteger(value) || value < 0)
            throw new Error('bitcoin_tip_height_unavailable');
        return value;
    }
    async fetchJson(path) {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: { accept: 'application/json' } });
        if (!response.ok)
            throw new Error(`bitcoin_http_${response.status}`);
        return response.json();
    }
}
module.exports = { BitcoinClient };
