"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const { OnchainProvider } = require('./provider');
class MockVerifier extends OnchainProvider {
    async verifyPayment({ txHash, expectedAmount, expectedAsset, expectedChain, recipientAddress }) {
        if (!txHash) {
            return { ok: false, reason: 'missing_tx_hash' };
        }
        if (txHash.startsWith('0xpaid')) {
            return {
                ok: true,
                observedAmount: expectedAmount,
                observedAsset: expectedAsset,
                observedChain: expectedChain,
                recipientAddress,
                confirmations: 1,
                blockNumber: 12345678
            };
        }
        return { ok: false, reason: 'tx_not_found_in_mock' };
    }
}
module.exports = { MockVerifier };
