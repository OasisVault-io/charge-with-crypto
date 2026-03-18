import { isFixedPegAsset } from '../pricing/priceSupport'
import {
  type AnyRecord,
  type AppConfig,
  type ManualPaymentServiceLike,
  type PriceServiceLike,
  type X402ServiceLike,
} from '../shared/types'
import { configuredAppMode } from './dashboardAuth'

type ConfigServiceDependencies = {
  config: AppConfig
  priceService: PriceServiceLike
  manualPaymentService: ManualPaymentServiceLike
  x402Service?: X402ServiceLike | null
}

class ConfigService {
  config: AppConfig
  priceService: PriceServiceLike
  manualPaymentService: ManualPaymentServiceLike
  x402Service: X402ServiceLike | null

  constructor({
    config,
    priceService,
    manualPaymentService,
    x402Service = null,
  }: ConfigServiceDependencies) {
    this.config = config
    this.priceService = priceService
    this.manualPaymentService = manualPaymentService
    this.x402Service = x402Service
  }

  setX402Service(x402Service: X402ServiceLike) {
    this.x402Service = x402Service
  }

  getPublicConfig() {
    return {
      appMode: configuredAppMode(this.config),
      deployedAppUrl: this.config.baseUrl,
      chains: this.config.chains,
      assets: this.config.assets,
      fixedPriceAssets: Object.keys(this.config.assets).filter((asset) =>
        isFixedPegAsset(asset),
      ),
      quoteExpirySeconds: this.config.quoteExpirySeconds,
      bitcoinQuoteExpirySeconds: this.config.bitcoinQuoteExpirySeconds,
      minConfirmations: this.config.minConfirmations,
      dashboardAuthConfigured: Boolean(this.config.dashboardToken),
      manualPayment: this.manualPaymentService?.status?.() || {
        configured: false,
        sponsorAddress: '',
        derivationPath: '',
      },
      bitcoin: {
        addressDerivationConfigured: Boolean(
          this.config.bitcoinPaymentXpub,
        ),
      },
      x402: this.x402Service?.status?.() || { enabled: false },
    }
  }

  getHealth() {
    const rpc = Object.fromEntries(
      Object.entries(this.config.chains).map(
        ([chain, chainConfig]: [string, AnyRecord]) => [
          chain,
          Boolean(process.env[String(chainConfig.rpcUrlEnv || '')]),
        ],
      ),
    )

    return {
      ok: true,
      name: 'charge-with-crypto',
      env: this.config.env,
      appMode: configuredAppMode(this.config),
      rpcConfigured: rpc,
      storage: 'sqlite',
      manualPaymentConfigured: Boolean(
        this.manualPaymentService?.isConfigured?.(),
      ),
    }
  }

  async getAssetPrice(chain: string, asset: string) {
    const price = await this.priceService.getAssetPrice({ chain, asset })
    return { price }
  }

  createWalletConnectIntent(body: AnyRecord) {
    const chain = String(body.chain || 'ethereum')
    const walletRail = chain === 'bitcoin' ? 'bitcoin' : 'evm'
    return {
      status: 'ok',
      sessionId: `wallet_session_${Math.random().toString(36).slice(2, 10)}`,
      chain,
      walletMode: walletRail === 'bitcoin' ? 'bitcoin-wallet' : 'injected-evm',
      walletRail,
      supported: Boolean(this.config.chains[chain]),
      requiresInjectedProvider: walletRail !== 'bitcoin',
    }
  }
}

export { ConfigService }
