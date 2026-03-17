import { type ProductService } from '../catalog/productService'
import {
	repositoriesFrom,
	type ServiceRepositories,
} from '../shared/repositories'
import {
	type AppConfig,
	type MerchantLike,
	type StoreLike,
} from '../shared/types'

const DEFAULT_ACCEPTED_ASSETS = ['USDC', 'USDT']
const DEFAULT_MERCHANT_ID = 'merchant_default'
const DEMO_MERCHANT_ID = 'merchant_demo'
const DEFAULT_MERCHANT_PLANS = [
	{
		id: 'starter',
		title: 'Starter',
		description: 'Entry plan for smaller purchases.',
		amountUsd: 19,
		paymentRail: 'evm',
		acceptedAssets: ['USDC', 'USDT'],
		enabledChains: ['base', 'arbitrum'],
	},
	{
		id: 'growth',
		title: 'Growth',
		description: 'Default plan for most customers.',
		amountUsd: 49,
		paymentRail: 'evm',
		acceptedAssets: ['USDC', 'USDT'],
		enabledChains: ['base', 'arbitrum', 'polygon'],
	},
	{
		id: 'scale',
		title: 'Scale',
		description: 'Higher-ticket plan with the same wallet-first flow.',
		amountUsd: 99,
		paymentRail: 'evm',
		acceptedAssets: ['USDC', 'USDT'],
		enabledChains: ['base', 'arbitrum', 'polygon', 'ethereum'],
	},
]
const DEFAULT_MERCHANT_RECORD = {
	id: DEFAULT_MERCHANT_ID,
	name: 'OasisVault',
	brandName: 'OasisVault',
	logoUrl: '/oasisvault-logo-green-cropped.png',
	supportEmail: 'payments@oasisvault.app',
	checkoutHeadline: 'Fast wallet-first crypto checkout',
	checkoutDescription:
		'Let customers connect a wallet, review the best route, and pay in one confirmation.',
}
const DEMO_MERCHANT_RECORD = {
	id: DEMO_MERCHANT_ID,
	name: 'Charge With Crypto',
	brandName: 'Charge With Crypto',
	logoUrl: '/charge-with-crypto-mark.svg',
	supportEmail: 'demo@chargewithcrypto.app',
	checkoutHeadline: 'Test a wallet-first crypto checkout',
	checkoutDescription:
		'Enter a receiving address, create a checkout, and test the end-to-end payment flow.',
}

function ensureMerchantDefaults(
	source: ServiceRepositories | StoreLike,
	config: AppConfig,
	productService: ProductService,
) {
	const repositories = repositoriesFrom(source)
	const defaultRecipients = {
		ethereum: '0x1111111111111111111111111111111111111111',
		base: '0x1111111111111111111111111111111111111111',
		arbitrum: '0x1111111111111111111111111111111111111111',
		polygon: '0x1111111111111111111111111111111111111111',
	}
	const defaultManualPaymentChains = ['base', 'ethereum'].filter(
		(chain) => config.chains[chain],
	)

	const merchantDefinitions = [
		{
			record: DEFAULT_MERCHANT_RECORD,
			webhookUrl: 'mock://webhook/merchant_default',
			publicCheckoutAllowed: true,
		},
		{
			record: DEMO_MERCHANT_RECORD,
			webhookUrl: 'mock://webhook/merchant_demo',
			publicCheckoutAllowed: true,
		},
	]

	for (const definition of merchantDefinitions) {
		const existing = repositories.merchants.get(definition.record.id)
		if (!existing) {
			const inserted = repositories.merchants.insert({
				...definition.record,
				webhookUrl: definition.webhookUrl,
				webhookSecret: config.webhookSecretFallback,
				recipientAddresses: defaultRecipients,
				defaultPaymentRail: 'evm',
				enabledChains: Object.keys(config.chains),
				manualPaymentEnabledChains: defaultManualPaymentChains,
				plans: DEFAULT_MERCHANT_PLANS.filter((plan) =>
					plan.enabledChains.every((chain) => config.chains[chain]),
				),
				defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS.filter(
					(asset) => config.assets[asset],
				),
				publicCheckoutAllowed: definition.publicCheckoutAllowed,
			})
			productService.upsertManagedProducts(inserted)
			continue
		}

		const patch: Partial<MerchantLike> = {}
		if (!existing.name) patch.name = definition.record.name
		if (!existing.brandName) {
			patch.brandName = existing.name || definition.record.brandName
		}
		if (!existing.logoUrl) patch.logoUrl = definition.record.logoUrl
		if (!existing.supportEmail) {
			patch.supportEmail = definition.record.supportEmail
		}
		if (!existing.webhookSecret) {
			patch.webhookSecret = config.webhookSecretFallback
		}
		if (
			!Array.isArray(existing.defaultAcceptedAssets) ||
			!existing.defaultAcceptedAssets.length
		) {
			patch.defaultAcceptedAssets = DEFAULT_ACCEPTED_ASSETS.filter(
				(asset) => config.assets[asset],
			)
		}
		if (!existing.defaultPaymentRail) patch.defaultPaymentRail = 'evm'
		if (!Array.isArray(existing.plans)) {
			patch.plans = DEFAULT_MERCHANT_PLANS.filter((plan) =>
				plan.enabledChains.every((chain) => config.chains[chain]),
			)
		}
		if (!existing.checkoutHeadline) {
			patch.checkoutHeadline = definition.record.checkoutHeadline
		}
		if (!existing.checkoutDescription) {
			patch.checkoutDescription = definition.record.checkoutDescription
		}
		if (typeof existing.publicCheckoutAllowed !== 'boolean') {
			patch.publicCheckoutAllowed = definition.publicCheckoutAllowed
		}
		if (!existing.enabledChains?.length && existing.recipientAddresses) {
			patch.enabledChains = Object.keys(config.chains).filter(
				(chain) => existing.recipientAddresses?.[chain],
			)
		}
		const merchantManualPaymentChains = defaultManualPaymentChains.filter(
			(chain) => existing.recipientAddresses?.[chain],
		)
		if (
			!Array.isArray(existing.manualPaymentEnabledChains) ||
			existing.manualPaymentEnabledChains.length !==
				merchantManualPaymentChains.length ||
			existing.manualPaymentEnabledChains.some(
				(chain, index) => chain !== merchantManualPaymentChains[index],
			)
		) {
			patch.manualPaymentEnabledChains = merchantManualPaymentChains
		}
		if (!existing.webhookUrl) patch.webhookUrl = definition.webhookUrl

		if (Object.keys(patch).length) {
			const updated =
				repositories.merchants.update(existing.id, patch) || existing
			productService.upsertManagedProducts(updated)
			continue
		}

		productService.upsertManagedProducts(existing)
	}

	return repositories.merchants.get(DEFAULT_MERCHANT_ID)
}

export {
	DEFAULT_ACCEPTED_ASSETS,
	DEFAULT_MERCHANT_ID,
	DEFAULT_MERCHANT_PLANS,
	DEFAULT_MERCHANT_RECORD,
	DEMO_MERCHANT_ID,
	DEMO_MERCHANT_RECORD,
	ensureMerchantDefaults,
}
