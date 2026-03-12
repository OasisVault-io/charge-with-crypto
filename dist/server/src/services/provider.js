"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
class OnchainProvider {
    async verifyPayment(_input) {
        throw new Error('Not implemented');
    }
}
class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }
    register(name, provider) {
        this.providers.set(name, provider);
    }
    get(name) {
        const provider = this.providers.get(name);
        if (!provider)
            throw new Error(`Provider not registered: ${name}`);
        return provider;
    }
}
module.exports = { OnchainProvider, ProviderRegistry };
