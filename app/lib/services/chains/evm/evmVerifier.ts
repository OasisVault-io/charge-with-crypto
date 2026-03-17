import { normalizeAddress } from '../../../utils/validation'
import { OnchainProvider } from '../../shared/provider'
import {
  type AppConfig,
  type EvmReceiptLike,
  type EvmTransactionLike,
  type FetchLike,
  type TransferLogLike,
  type VerificationInput,
  type VerificationResult,
} from '../../shared/types'
import { RpcClient } from './rpcClient'

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function hexToBigInt(value: string | null | undefined) {
  return BigInt(value || '0x0')
}

function topicAddress(topic: string | null | undefined) {
  return `0x${String(topic).slice(-40)}`.toLowerCase()
}

class EvmVerifier extends OnchainProvider {
  config: AppConfig
  chain: string
  rpcUrl: string
  minConfirmations: number
  client: {
    call(method: string, params?: unknown[]): Promise<unknown>
  } | null

  constructor({
    config,
    chain,
    fetchImpl,
    rpcUrl,
    minConfirmations = 1,
  }: {
    config: AppConfig
    chain: string
    fetchImpl?: FetchLike
    rpcUrl?: string
    minConfirmations?: number
  }) {
    super()
    const rpcEnv = config.chains[chain]?.rpcUrlEnv
    this.config = config
    this.chain = chain
    this.rpcUrl = rpcUrl || process.env[rpcEnv] || ''
    this.minConfirmations = minConfirmations
    this.client = this.rpcUrl ? new RpcClient(this.rpcUrl, { fetchImpl }) : null
  }

  async verifyPayment(input: VerificationInput): Promise<VerificationResult> {
    if (!this.client) throw new Error(`missing rpc for ${this.chain}`)
    const receipt = (await this.client.call('eth_getTransactionReceipt', [
      input.txHash,
    ])) as EvmReceiptLike | null
    if (!receipt) return { ok: false, reason: 'tx_not_found' }
    if (receipt.status !== '0x1')
      return { ok: false, reason: 'tx_failed', receipt }

    const tx = (await this.client.call('eth_getTransactionByHash', [
      input.txHash,
    ])) as EvmTransactionLike | null
    if (!tx) return { ok: false, reason: 'tx_not_found' }
    const latestBlock = String(await this.client.call('eth_blockNumber'))
    const confirmations = Number(
      hexToBigInt(latestBlock) - hexToBigInt(receipt.blockNumber) + 1n,
    )
    if (confirmations < this.minConfirmations) {
      return {
        ok: false,
        reason: 'insufficient_confirmations',
        confirmations,
        minConfirmations: this.minConfirmations,
      }
    }

    const senderAddress = normalizeAddress(
      tx.from || '0x0000000000000000000000000000000000000000',
    )
    if (input.walletAddress) {
      const expectedSender = normalizeAddress(input.walletAddress)
      if (senderAddress !== expectedSender) {
        return {
          ok: false,
          reason: 'wallet_mismatch',
          confirmations,
          senderAddress,
          expectedWalletAddress: expectedSender,
        }
      }
    }

    const expectedRecipient = normalizeAddress(input.recipientAddress)
    const assetConfig = this.config.assets[input.expectedAsset || '']
    if (!assetConfig) return { ok: false, reason: 'unsupported_asset' }
    if (assetConfig.type === 'native') {
      const to = normalizeAddress(
        tx.to || '0x0000000000000000000000000000000000000000',
      )
      const amount = hexToBigInt(tx.value)
      const expected = BigInt(input.expectedAmountBaseUnits)
      return {
        ok: to === expectedRecipient && amount >= expected,
        confirmations,
        observedAmountBaseUnits: amount.toString(),
        expectedAmountBaseUnits: expected.toString(),
        senderAddress,
        recipientAddress: to,
        reason:
          to !== expectedRecipient
            ? 'recipient_mismatch'
            : amount < expected
              ? 'amount_too_low'
              : 'confirmed',
      }
    }

    const configuredTokenAddress = assetConfig.addresses[this.chain]
    if (!configuredTokenAddress)
      return { ok: false, reason: 'unsupported_asset' }
    const tokenAddress = normalizeAddress(configuredTokenAddress)
    const log = (receipt.logs || []).find(
      (entry: TransferLogLike) =>
        normalizeAddress(entry.address) === tokenAddress &&
        entry.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC &&
        topicAddress(entry.topics[2]) === expectedRecipient,
    )

    if (!log)
      return { ok: false, reason: 'transfer_log_not_found', confirmations }
    const amount = hexToBigInt(log.data)
    const expected = BigInt(input.expectedAmountBaseUnits)

    return {
      ok: amount >= expected,
      confirmations,
      observedAmountBaseUnits: amount.toString(),
      expectedAmountBaseUnits: expected.toString(),
      senderAddress,
      recipientAddress: expectedRecipient,
      tokenAddress,
      reason: amount < expected ? 'amount_too_low' : 'confirmed',
    }
  }
}

export { EvmVerifier }
