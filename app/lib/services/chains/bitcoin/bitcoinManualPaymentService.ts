import QRCode from 'qrcode'
import { formatBitcoinUri } from '../../../utils/bitcoin'
import { recordManualDetectedPayment } from '../../payments/paymentService'
import { getActiveQuotesForCheckout } from '../../payments/quoteService'
import {
  type AnyRecord,
  type AppConfig,
  type BitcoinTransaction,
  type CheckoutLike,
  type FetchLike,
  type QuoteLike,
  type StatusError,
  type StoreLike,
} from '../../shared/types'
import { BitcoinClient } from './bitcoinClient'

type BitcoinManualPaymentServiceDependencies = {
  store: StoreLike
  config: AppConfig
  fetchImpl?: FetchLike
}

type BitcoinRoute = {
  available: boolean
  chain: 'bitcoin'
  asset: 'BTC'
  address: string
  addressSource: string
  derivationIndex: number | null
  cryptoAmount?: string
  cryptoAmountBaseUnits?: string
  status: string
}

class BitcoinManualPaymentService {
  store: StoreLike
  config: AppConfig
  fetchImpl: FetchLike
  client: {
    getAddressTxs(address: string): Promise<BitcoinTransaction[]>
    getTipHeight(): Promise<number>
  } | null

  constructor({
    store,
    config,
    fetchImpl = fetch,
  }: BitcoinManualPaymentServiceDependencies) {
    this.store = store
    this.config = config
    this.fetchImpl = fetchImpl
    this.client = config.chains.bitcoin
      ? new BitcoinClient({
          baseUrl: config.bitcoinEsploraBaseUrl,
          fetchImpl,
        })
      : null
  }

  isConfigured(): boolean {
    return Boolean(this.client)
  }

  supportsCheckout(
    checkout: CheckoutLike,
    quotes = getActiveQuotesForCheckout(this.store, checkout.id) as QuoteLike[],
  ): boolean {
    const hasBtcQuote = (quotes || []).some(
      (quote) => quote.chain === 'bitcoin' && quote.asset === 'BTC',
    )
    return Boolean(hasBtcQuote && checkout?.recipientByChain?.bitcoin)
  }

  supportsAutomaticDetection(
    checkout: CheckoutLike,
    quotes = getActiveQuotesForCheckout(this.store, checkout.id) as QuoteLike[],
  ): boolean {
    return Boolean(
      this.supportsCheckout(checkout, quotes) &&
      checkout?.bitcoinSettlement?.addressSource === 'xpub',
    )
  }

  async createManualPaymentRoute({
    checkout,
    quotes,
  }: {
    checkout: CheckoutLike
    quotes?: QuoteLike[]
  }): Promise<BitcoinRoute | null> {
    const quote = (quotes || []).find(
      (entry) => entry.chain === 'bitcoin' && entry.asset === 'BTC',
    )
    const recipientAddress = checkout.recipientByChain?.bitcoin
    if (!quote || !this.supportsCheckout(checkout, quotes)) return null
    if (!recipientAddress) return null
    return {
      available: true,
      chain: 'bitcoin',
      asset: 'BTC',
      address: recipientAddress,
      addressSource: checkout.bitcoinSettlement?.addressSource || '',
      derivationIndex: checkout.bitcoinSettlement?.derivationIndex ?? null,
      cryptoAmount: quote.cryptoAmount,
      cryptoAmountBaseUnits: quote.cryptoAmountBaseUnits,
      status:
        checkout.status === 'paid' && checkout.paidChain === 'bitcoin'
          ? 'paid'
          : 'awaiting_payment',
    }
  }

  async getRouteDetails(checkout: CheckoutLike): Promise<AnyRecord | null> {
    const quote = (
      getActiveQuotesForCheckout(this.store, checkout.id) as QuoteLike[]
    ).find((entry) => entry.chain === 'bitcoin' && entry.asset === 'BTC')
    const route = await this.createManualPaymentRoute({
      checkout,
      quotes: quote ? [quote] : [],
    })
    if (!route) return null
    const paymentUri = formatBitcoinUri({
      address: route.address,
      amountBtc: route.cryptoAmount,
    })
    return {
      ...route,
      autoDetection: this.supportsAutomaticDetection(
        checkout,
        quote ? [quote] : [],
      ),
      paymentUri,
      qrSvg: await QRCode.toString(paymentUri, {
        type: 'svg',
        margin: 0,
        color: { dark: '#27fa7b', light: '#0000' },
      }),
    }
  }

  async reconcileCheckout(checkout: CheckoutLike): Promise<CheckoutLike> {
    if (
      !this.supportsAutomaticDetection(checkout) ||
      checkout.status === 'paid'
    )
      return checkout
    const recipientAddress = checkout.recipientByChain?.bitcoin
    if (!recipientAddress) return checkout
    const quote = (
      getActiveQuotesForCheckout(this.store, checkout.id) as QuoteLike[]
    ).find((entry) => entry.chain === 'bitcoin' && entry.asset === 'BTC')
    if (!quote) return checkout
    if (!this.client) return checkout

    const txs = await this.client.getAddressTxs(recipientAddress)
    if (!Array.isArray(txs) || !txs.length) return checkout
    const tipHeight = await this.client.getTipHeight()
    const expected = BigInt(quote.cryptoAmountBaseUnits)

    for (const tx of txs) {
      const status = tx.status || {}
      if (!status.confirmed) continue
      const blockHeight = Number(status.block_height || 0)
      const confirmations =
        blockHeight > 0 ? Math.max(1, tipHeight - blockHeight + 1) : 0
      if (confirmations < this.config.minConfirmations) continue

      const observed = BigInt(
        (tx.vout || [])
          .filter((output) => output.scriptpubkey_address === recipientAddress)
          .reduce((sum, output) => sum + Number(output.value || 0), 0),
      )
      if (observed < expected) continue

      try {
        await recordManualDetectedPayment({
          store: this.store,
          config: this.config,
          checkout,
          quote,
          txHash: tx.txid,
          walletAddress: '',
          recipientAddress,
          observedAmountBaseUnits: observed.toString(),
          tokenAddress: '',
          blockNumber: blockHeight,
          confirmations,
        })
      } catch (err) {
        const error = err as StatusError
        if (checkout?.manualPayment) {
          this.store.update('checkouts', checkout.id, {
            manualPayment: {
              ...(checkout.manualPayment || {}),
              lastScanError: error.message,
            },
          })
        }
        break
      }
      break
    }

    return (
      (this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
      checkout
    )
  }
}

export { BitcoinManualPaymentService }
