import { config, validateRuntimeConfig } from './config'
import { BalanceService } from './services/balanceService'
import { ProductService } from './services/catalog/productService'
import { BitcoinAddressService } from './services/chains/bitcoin/bitcoinAddressService'
import { BitcoinManualPaymentService } from './services/chains/bitcoin/bitcoinManualPaymentService'
import { BitcoinVerifier } from './services/chains/bitcoin/bitcoinVerifier'
import { EvmVerifier } from './services/chains/evm/evmVerifier'
import { CheckoutService } from './services/checkout/checkoutService'
import { CompositeManualPaymentService } from './services/manual-payment/compositeManualPaymentService'
import { ManualPaymentService } from './services/manual-payment/manualPaymentService'
import { ConfigService } from './services/merchant/configService'
import { DashboardService } from './services/merchant/dashboardService'
import { ensureMerchantDefaults } from './services/merchant/merchantDefaults'
import { PaymentService } from './services/payments/paymentService'
import { QuoteService } from './services/payments/quoteService'
import { PriceService } from './services/pricing/priceService'
import { McpService } from './services/protocols/mcpService'
import { X402Service } from './services/protocols/x402Service'
import { ProviderRegistry } from './services/shared/provider'
import { createServiceRepositories } from './services/shared/repositories'
import { SqliteStore } from './store/sqliteStore'

function createAppContext(customConfig: typeof config = config) {
	validateRuntimeConfig(customConfig)

	const store = new SqliteStore(customConfig.dataDir)
	const repositories = createServiceRepositories(store)

	const providers = new ProviderRegistry()
	Object.keys(customConfig.chains).forEach((chain) => {
		if (chain === 'bitcoin') {
			providers.register(
				chain,
				new BitcoinVerifier({
					config: customConfig,
					minConfirmations: customConfig.minConfirmations,
				}),
			)
			return
		}
		providers.register(
			chain,
			new EvmVerifier({
				config: customConfig,
				chain,
				minConfirmations: customConfig.minConfirmations,
			}),
		)
	})

	const priceService = new PriceService({ config: customConfig })
	const balanceService = new BalanceService({ config: customConfig })
	const paymentService = new PaymentService({
		repositories,
		providers,
		config: customConfig,
	})
	const quoteService = new QuoteService({
		repositories,
		priceService,
		config: customConfig,
	})
	const evmManualPaymentService = new ManualPaymentService({
		store,
		config: customConfig,
	})
	const bitcoinManualPaymentService = new BitcoinManualPaymentService({
		store,
		config: customConfig,
	})
	const manualPaymentService = new CompositeManualPaymentService({
		evmService: evmManualPaymentService,
		bitcoinService: bitcoinManualPaymentService,
	})
	const bitcoinAddressService = new BitcoinAddressService({
		store,
		config: customConfig,
	})
	const productService = new ProductService({
		repositories,
		config: customConfig,
		priceService,
		manualPaymentService,
		bitcoinAddressService,
	})
	ensureMerchantDefaults(repositories, customConfig, productService)
	const x402Service = new X402Service({
		store,
		config: customConfig,
		priceService,
		manualPaymentService,
		bitcoinAddressService,
		productService,
	})
	productService.setX402Service(x402Service)
	const configService = new ConfigService({
		config: customConfig,
		priceService,
		manualPaymentService,
		x402Service,
	})
	const dashboardService = new DashboardService({
		repositories,
		config: customConfig,
		productService,
	})
	const checkoutService = new CheckoutService({
		repositories,
		config: customConfig,
		providers,
		configService,
		quoteService,
		paymentService,
		balanceService,
		manualPaymentService,
		bitcoinAddressService,
	})
	const mcpService = new McpService({
		store,
		config: customConfig,
		priceService,
		manualPaymentService,
		bitcoinAddressService,
		x402Service,
		productService,
	})

	return {
		config: customConfig,
		store,
		providers,
		configService,
		checkoutService,
		dashboardService,
		productService,
		priceService,
		balanceService,
		paymentService,
		quoteService,
		manualPaymentService,
		bitcoinAddressService,
		x402Service,
		mcpService,
	}
}

type AppContext = ReturnType<typeof createAppContext>

function startAppContext(context: AppContext) {
	context.manualPaymentService.start()
	context.x402Service?.initialize?.().catch((err) => {
		console.error('x402_init_error', err)
	})
	return context
}

function stopAppContext(context: AppContext) {
	context.manualPaymentService.stop()
}

export { createAppContext, startAppContext, stopAppContext }
