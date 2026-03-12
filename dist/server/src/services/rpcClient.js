"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
class RpcClient {
    constructor(endpoint, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
        this.endpoint = endpoint;
        this.timeoutMs = timeoutMs;
        this.fetchImpl = fetchImpl;
        this.nextId = 1;
    }
    async call(method, params = []) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
                signal: controller.signal
            });
            if (!response.ok)
                throw new Error(`rpc_http_${response.status}`);
            const payload = await response.json();
            if (payload.error)
                throw new Error(payload.error.message || 'rpc_error');
            return payload.result;
        }
        finally {
            clearTimeout(timer);
        }
    }
}
module.exports = { RpcClient };
