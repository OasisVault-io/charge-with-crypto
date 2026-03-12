"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const { RpcClient } = require('./rpcClient');
const { baseUnitsToDecimalString } = require('../utils/amounts');
function balanceOfCallData(address) {
    return `0x70a08231000000000000000000000000${String(address).toLowerCase().replace(/^0x/, '')}`;
}
class EvmBalanceService {
    constructor({ config, fetchImpl = fetch }) {
        this.config = config;
        this.clients = new Map();
        for (const [chain, chainConfig] of Object.entries(config.chains)) {
            if (chain === 'bitcoin')
                continue;
            const endpoint = process.env[chainConfig.rpcUrlEnv];
            if (!endpoint)
                continue;
            this.clients.set(chain, new RpcClient(endpoint, { fetchImpl }));
        }
    }
    client(chain) {
        const client = this.clients.get(chain);
        if (!client)
            throw new Error(`missing rpc for ${chain}`);
        return client;
    }
    async readRouteBalance({ walletAddress, chain, asset }) {
        const assetConfig = this.config.assets[asset];
        const client = this.client(chain);
        if (assetConfig.type === 'native') {
            const raw = BigInt(await client.call('eth_getBalance', [walletAddress, 'latest']));
            return { raw: raw.toString(), display: baseUnitsToDecimalString(raw, assetConfig.decimals, 6) };
        }
        const tokenAddress = assetConfig.addresses?.[chain];
        if (!tokenAddress)
            throw new Error(`asset not available on ${chain}`);
        const raw = BigInt(await client.call('eth_call', [{ to: tokenAddress, data: balanceOfCallData(walletAddress) }, 'latest']));
        return { raw: raw.toString(), display: baseUnitsToDecimalString(raw, assetConfig.decimals, 6) };
    }
}
module.exports = { EvmBalanceService };
