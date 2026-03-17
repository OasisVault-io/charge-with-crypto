import { getAppContext, getConfig } from '../runtime'
import { configuredAppMode } from './dashboardAuth'
import * as legacyPriceService from './priceService'

export function getPublicConfig() {
	const config = getConfig()
	const context = getAppContext()
	return {
		appMode: configuredAppMode(config),
		chains: config.chains,
		assets: config.assets,
		fixedPriceAssets: Object.keys(config.assets).filter((asset) =>
			legacyPriceService.isFixedPegAsset(asset),
		),
		quoteExpirySeconds: config.quoteExpirySeconds,
		bitcoinQuoteExpirySeconds: config.bitcoinQuoteExpirySeconds,
		minConfirmations: config.minConfirmations,
		dashboardAuthConfigured: Boolean(config.dashboardToken),
		manualPayment: context.manualPaymentService?.status?.() || {
			configured: false,
			sponsorAddress: '',
			derivationPath: '',
		},
		x402: context.x402Service?.status?.() || { enabled: false },
	}
}

export function getHealth() {
	const config = getConfig()
	const context = getAppContext()
	const rpc = Object.fromEntries(
		Object.entries(config.chains).map(([chain, chainConfig]: [string, any]) => [
			chain,
			Boolean(process.env[chainConfig.rpcUrlEnv]),
		]),
	)

	return {
		ok: true,
		name: 'charge-with-crypto',
		env: config.env,
		appMode: configuredAppMode(config),
		rpcConfigured: rpc,
		storage: 'sqlite',
		manualPaymentConfigured: Boolean(
			context.manualPaymentService?.isConfigured?.(),
		),
	}
}

export async function getAssetPrice(chain: string, asset: string) {
	const context = getAppContext()
	const price = await context.priceService.getAssetPrice({ chain, asset })
	return { price }
}

export function createWalletConnectIntent(body: Record<string, any>) {
	const config = getConfig()
	const chain = body.chain || 'ethereum'
	const walletRail = chain === 'bitcoin' ? 'bitcoin' : 'evm'
	return {
		status: 'ok',
		sessionId: `wallet_session_${Math.random().toString(36).slice(2, 10)}`,
		chain,
		walletMode: walletRail === 'bitcoin' ? 'bitcoin-wallet' : 'injected-evm',
		walletRail,
		supported: Boolean(config.chains[chain]),
		requiresInjectedProvider: walletRail !== 'bitcoin',
	}
}
