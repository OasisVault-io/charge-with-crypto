import { OnchainProvider } from './shared/provider'
import { type VerificationInput, type VerificationResult } from './shared/types'

class MockVerifier extends OnchainProvider {
  async verifyPayment({
    txHash,
    expectedAmountBaseUnits,
    expectedAsset,
    expectedChain,
    recipientAddress,
  }: VerificationInput): Promise<VerificationResult> {
    if (!txHash) {
      return { ok: false, reason: 'missing_tx_hash' }
    }

    if (txHash.startsWith('0xpaid')) {
      return {
        ok: true,
        reason: 'confirmed',
        observedAmountBaseUnits: expectedAmountBaseUnits,
        observedAsset: expectedAsset,
        observedChain: expectedChain,
        recipientAddress,
        confirmations: 1,
        blockNumber: 12345678,
      }
    }

    return { ok: false, reason: 'tx_not_found_in_mock' }
  }
}

export { MockVerifier }
