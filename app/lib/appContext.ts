// @ts-nocheck
import { config, validateRuntimeConfig } from './config'
import { BitcoinAddressService } from './services/bitcoinAddressService'
import { BalanceService } from './services/balanceService'
import { BitcoinManualPaymentService } from './services/bitcoinManualPaymentService'
import { BitcoinVerifier } from './services/bitcoinVerifier'
import { CompositeManualPaymentService } from './services/compositeManualPaymentService'
import { ensureMerchantDefaults } from './services/merchantDefaults'
import { EvmVerifier } from './services/evmVerifier'
import { ManualPaymentService } from './services/manualPaymentService'
import { McpService } from './services/mcpService'
import { PriceService } from './services/priceService'
import { ProviderRegistry } from './services/provider'
import { X402Service } from './services/x402Service'
import { SqliteStore } from './store/sqliteStore'

function createAppContext(customConfig = config) {
	validateRuntimeConfig(customConfig)

	const store = new SqliteStore(customConfig.dataDir)
	ensureMerchantDefaults(store, customConfig)

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
	const x402Service = new X402Service({
		store,
		config: customConfig,
		priceService,
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
	})

	return {
		config: customConfig,
		store,
		providers,
		priceService,
		balanceService,
		manualPaymentService,
		bitcoinAddressService,
		x402Service,
		mcpService,
	}
}

function startAppContext(context) {
	context.manualPaymentService.start()
	context.x402Service?.initialize?.().catch((err) => {
		console.error('x402_init_error', err)
	})
	return context
}

function stopAppContext(context) {
	context.manualPaymentService.stop()
}

export { createAppContext, startAppContext, stopAppContext }
