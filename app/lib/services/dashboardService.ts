import { randomBytes } from 'node:crypto'
import { getAppContext, getConfig } from '../runtime'
import {
	createMerchantBodySchema,
	updateMerchantBodySchema,
} from '../schemas/api'
import { parseBody, requestHeader } from '../utils/api'
import * as bitcoin from '../utils/bitcoin'
import * as validation from '../utils/validation'
import {
	deriveAcceptedAssets,
	deriveEnabledChains,
	derivePaymentRail,
	normalizeManualPaymentEnabledChains,
	normalizeMerchantPayload,
	normalizePlans,
	normalizeUrlValue,
} from './checkoutConfig'
import {
	dashboardRequestAuthenticated,
	redactMerchant,
	requireDashboardAuth,
} from './dashboardAuth'
import * as productService from './productService'

export function getDashboardData(
	request: Request,
	merchantId = 'merchant_default',
) {
	const config = getConfig()
	const { store } = getAppContext()
	const authenticated = dashboardRequestAuthenticated(
		{
			headers: Object.fromEntries(request.headers.entries()),
		},
		config,
	)
	const locked = Boolean(config.dashboardToken) && !authenticated

	if (locked) {
		return {
			merchantId,
			authenticated: false,
			locked: true,
			merchant: null,
			checkouts: [],
			payments: [],
			events: [],
			webhookDeliveries: [],
		}
	}

	const checkouts = store.find(
		'checkouts',
		(c: any) => c.merchantId === merchantId,
	)
	const checkoutIds = new Set(checkouts.map((checkout: any) => checkout.id))
	const payments = store.find('payments', (payment: any) =>
		checkoutIds.has(payment.checkoutId),
	)
	const events = store
		.find(
			'events',
			(event: any) =>
				event.merchantId === merchantId || checkoutIds.has(event.checkoutId),
		)
		.slice(0, 25)
	const eventIds = new Set(events.map((event: any) => event.id))

	return {
		merchantId,
		authenticated,
		locked: false,
		merchant: redactMerchant(store.getById('merchants', merchantId), {
			includeBitcoinXpub: authenticated,
		}),
		checkouts,
		payments,
		events,
		webhookDeliveries: store
			.find(
				'webhook_deliveries',
				(delivery: any) =>
					delivery.merchantId === merchantId || eventIds.has(delivery.eventId),
			)
			.slice(0, 25),
	}
}

export async function updateMerchant(request: Request, merchantId: string) {
	const config = getConfig()
	const { store } = getAppContext()
	requireDashboardAuth(
		{
			headers: Object.fromEntries(request.headers.entries()),
		},
		config,
	)

	const merchant = store.getById('merchants', merchantId)
	if (!merchant) {
		const err: any = new Error('merchant not found')
		err.statusCode = 404
		throw err
	}

	const body = await parseBody<Record<string, any>>(
		request,
		updateMerchantBodySchema,
	)
	const patch: Record<string, any> = {}
	const nextAddresses = { ...(merchant.recipientAddresses || {}) }
	if (body.recipientAddresses) {
		for (const [chain, address] of Object.entries(body.recipientAddresses)) {
			nextAddresses[chain] = validation.requireChainAddress(
				address,
				chain,
				`${chain} recipientAddress`,
				config.chains[chain],
			)
		}
		patch.recipientAddresses = nextAddresses
	}
	const nextBitcoinXpub =
		body.bitcoinXpub != null
			? String(body.bitcoinXpub || '').trim()
				? bitcoin.requireBitcoinXpub(
						body.bitcoinXpub,
						'bitcoinXpub',
						config.chains.bitcoin,
					)
				: ''
			: merchant.bitcoinXpub
	Object.assign(
		patch,
		normalizeMerchantPayload({
			body,
			merchant,
			config,
			nextAddresses,
			nextBitcoinXpub,
		}),
	)
	const updated = store.update('merchants', merchant.id, patch)
	productService.upsertManagedProducts({ store, merchant: updated, config })
	return {
		merchant: redactMerchant(updated, { includeBitcoinXpub: true }),
	}
}

export function listMerchants() {
	const { store } = getAppContext()
	return {
		merchants: store
			.list('merchants')
			.map((merchant: any) => redactMerchant(merchant)),
	}
}

export async function createMerchant(request: Request) {
	const config = getConfig()
	const { store } = getAppContext()
	requireDashboardAuth(
		{
			headers: Object.fromEntries(request.headers.entries()),
		},
		config,
	)
	const body = await parseBody<Record<string, any>>(
		request,
		createMerchantBodySchema,
	)
	if (!body.name) {
		const err: any = new Error('name is required')
		err.statusCode = 400
		throw err
	}
	const recipientAddresses: Record<string, string> = {}
	for (const chain of Object.keys(config.chains)) {
		const value = body.recipientAddresses?.[chain]
		if (value)
			recipientAddresses[chain] = validation.requireChainAddress(
				value,
				chain,
				`${chain} recipientAddress`,
				config.chains[chain],
			)
	}
	const bitcoinXpub = body.bitcoinXpub
		? bitcoin.requireBitcoinXpub(
				body.bitcoinXpub,
				'bitcoinXpub',
				config.chains.bitcoin,
			)
		: ''
	const enabledChains = deriveEnabledChains({
		body,
		merchant: {
			recipientAddresses,
			enabledChains: body.enabledChains,
			bitcoinXpub,
		},
		config,
	})
	const merchant = {
		id: body.id || undefined,
		name: validation.requireOptionalString(body.name, 'name', { max: 80 }),
		brandName: validation.requireOptionalString(
			body.brandName || body.name,
			'brandName',
			{ max: 80 },
		),
		logoUrl:
			normalizeUrlValue(body.logoUrl, 'logoUrl', {
				allowMock: true,
				allowData: true,
			}) || '',
		supportEmail: validation.requireOptionalString(
			body.supportEmail,
			'supportEmail',
			{ max: 160 },
		),
		defaultPaymentRail: derivePaymentRail({
			body: { paymentRail: body.defaultPaymentRail || body.paymentRail },
			fallback: 'evm',
			config,
		}),
		webhookUrl: validation.requireUrl(
			body.webhookUrl || 'mock://webhook/custom',
			'webhookUrl',
			{ allowMock: true },
		),
		webhookSecret:
			validation.requireOptionalString(body.webhookSecret, 'webhookSecret', {
				max: 240,
			}) ||
			requestHeader(request, 'x-generated-secret') ||
			`whsec_${randomBytes(18).toString('hex')}`,
		recipientAddresses,
		bitcoinXpub,
		publicCheckoutAllowed: Boolean(body.publicCheckoutAllowed),
		enabledChains,
		manualPaymentEnabledChains: normalizeManualPaymentEnabledChains(
			body.manualPaymentEnabledChains || enabledChains,
			config,
			{ recipientAddresses, bitcoinXpub },
		),
		plans: normalizePlans(body.plans || [], config),
		defaultAcceptedAssets: deriveAcceptedAssets({
			body: {
				acceptedAssets: body.defaultAcceptedAssets ||
					body.acceptedAssets ||
					body.assets || ['USDC', 'USDT'],
			},
			merchant: { defaultAcceptedAssets: ['USDC', 'USDT'] },
			enabledChains,
			config,
		}),
		checkoutHeadline: validation.requireOptionalString(
			body.checkoutHeadline,
			'checkoutHeadline',
			{ max: 120 },
		),
		checkoutDescription: validation.requireOptionalString(
			body.checkoutDescription,
			'checkoutDescription',
			{ max: 240 },
		),
	}
	const inserted = store.insert('merchants', merchant)
	productService.upsertManagedProducts({ store, merchant: inserted, config })
	return { merchant: redactMerchant(inserted, { includeBitcoinXpub: true }) }
}
