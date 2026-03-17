import { nowIso } from '../../utils/time'
import { normalizeChainTxHash } from '../../utils/validation'
import { badRequest, conflict } from '../shared/appError'
import {
	repositoriesFrom,
	resolveServiceRepositories,
	type ServiceRepositories,
} from '../shared/repositories'
import * as webhookDelivery from './webhookDelivery'
import {
	type AnyRecord,
	type AppConfig,
	type CheckoutLike,
	type PaymentRecord,
	type QuoteLike,
	type StoreLike,
	type VerificationResult,
} from '../shared/types'

type ProviderRegistryLike = {
	get(name: string): {
		verifyPayment(input: AnyRecord): Promise<AnyRecord>
	}
}

type PaymentServiceDependencies = {
	repositories?: ServiceRepositories
	store?: StoreLike
	providers: ProviderRegistryLike
	config: AppConfig
}

type VerifyPaymentAndRecordInput = {
	repositories?: ServiceRepositories
	store?: StoreLike
	providers: ProviderRegistryLike
	config: AppConfig
	checkout: CheckoutLike
	quote: QuoteLike
	chain?: string
	txHash: string
	walletAddress?: string
}

type ReconcilePendingCheckoutPaymentsInput = {
	repositories?: ServiceRepositories
	store?: StoreLike
	providers: ProviderRegistryLike
	config: AppConfig
	checkout: CheckoutLike
}

type RecordManualDetectedPaymentInput = {
	repositories?: ServiceRepositories
	store?: StoreLike
	config: AppConfig
	checkout: CheckoutLike
	quote: QuoteLike
	txHash: string
	walletAddress?: string
	recipientAddress: string
	observedAmountBaseUnits: string
	tokenAddress?: string
	blockNumber?: number
	confirmations?: number
}

type RecordConfirmedExternalPaymentInput = {
	repositories?: ServiceRepositories
	store?: StoreLike
	config: AppConfig
	checkout: CheckoutLike
	quote: QuoteLike
	txHash: string
	walletAddress?: string | null
	recipientAddress: string
	method?: string
	verification?: AnyRecord
}

let dispatchWebhookImpl = webhookDelivery.dispatchWebhook

function setDispatchWebhookImplementation(
	dispatcher: typeof webhookDelivery.dispatchWebhook,
) {
	dispatchWebhookImpl = dispatcher
}

function resetDispatchWebhookImplementation() {
	dispatchWebhookImpl = webhookDelivery.dispatchWebhook
}

function conflictingPaymentForTx({
	repositories: providedRepositories,
	store,
	checkoutId,
	chain,
	txHash,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
	checkoutId: string
	chain: string
	txHash: string
}) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	return repositories.payments.findConflictingChainTx(checkoutId, chain, txHash)
}

function existingPaymentForCheckoutTx({
	repositories: providedRepositories,
	store,
	checkoutId,
	chain,
	txHash,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
	checkoutId: string
	chain: string
	txHash: string
}) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	return repositories.payments.findByCheckoutChainTx(checkoutId, chain, txHash)
}

async function emitPaymentConfirmed({
	repositories: providedRepositories,
	store,
	config,
	checkout,
	quote,
	payment,
	chain,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
	config: AppConfig
	checkout: CheckoutLike
	quote: QuoteLike
	payment: PaymentRecord
	chain: string
}) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	const recipientAddress =
		checkout.recipientByChain?.[chain] || checkout.recipientAddress
	const event = repositories.events.insert({
		merchantId: checkout.merchantId,
		checkoutId: checkout.id,
		paymentId: payment.id,
		type: 'payment.confirmed',
		data: {
			checkoutId: checkout.id,
			productId: checkout.productId || null,
			referenceId: checkout.referenceId || null,
			purchaseId: checkout.x402?.purchaseId || null,
			planId: checkout.planId || null,
			quantity: Number(checkout.quantity || 1),
			purchaseFlow: checkout.purchaseFlow || 'hosted_checkout',
			title: checkout.title || checkout.orderId,
			description: checkout.description || '',
			merchantId: checkout.merchantId,
			merchantName: checkout.merchantName,
			orderId: checkout.orderId,
			paymentId: payment.id,
			txHash: payment.txHash,
			amount: quote.cryptoAmount,
			amountBaseUnits: quote.cryptoAmountBaseUnits,
			amountUsd: checkout.amountUsd,
			asset: quote.asset,
			chain: quote.chain,
			recipientAddress,
		},
	})

	const merchant = repositories.merchants.get(String(checkout.merchantId || ''))
	if (merchant) {
		void dispatchWebhookImpl({ repositories, config, merchant, event })
	}
}

async function confirmCheckoutIfNeeded({
	repositories: providedRepositories,
	store,
	config,
	checkout,
	quote,
	payment,
	chain,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
	config: AppConfig
	checkout: CheckoutLike
	quote: QuoteLike
	payment: PaymentRecord
	chain: string
}) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	if (checkout.status === 'paid') {
		return repositories.checkouts.get(checkout.id) || checkout
	}
	repositories.checkouts.update(checkout.id, {
		status: 'paid',
		paidAt: nowIso(),
		paymentId: payment.id,
		paidChain: quote.chain,
		paidAsset: quote.asset,
		recipientAddress: payment.recipientAddress,
	})
	await emitPaymentConfirmed({
		repositories,
		config,
		checkout,
		quote,
		payment,
		chain: chain || String(quote.chain || ''),
	})
	return repositories.checkouts.get(checkout.id) || checkout
}

async function verifyQuotePayment({
	providers,
	quote,
	recipientAddress,
	txHash,
	walletAddress,
}: {
	providers: ProviderRegistryLike
	quote: QuoteLike
	recipientAddress?: string
	txHash: string
	walletAddress?: string
}): Promise<VerificationResult> {
	const provider = providers.get(String(quote.chain || ''))
	return (await provider.verifyPayment({
		txHash,
		walletAddress,
		expectedAmount: quote.cryptoAmount,
		expectedAmountBaseUnits: quote.cryptoAmountBaseUnits,
		expectedAsset: quote.asset,
		expectedChain: quote.chain,
		recipientAddress,
	})) as VerificationResult
}

async function verifyPaymentAndRecord({
	repositories: providedRepositories,
	store,
	providers,
	config,
	checkout,
	quote,
	chain,
	txHash,
	walletAddress,
}: VerifyPaymentAndRecordInput) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	const txChain = String(quote.chain || chain || '')
	let normalizedTxHash: string
	try {
		normalizedTxHash = normalizeChainTxHash(txHash, txChain)
	} catch (error) {
		throw badRequest(
			error instanceof Error ? error.message : 'invalid transaction hash',
		)
	}

	const conflicting = conflictingPaymentForTx({
		repositories,
		checkoutId: checkout.id,
		chain: txChain,
		txHash: normalizedTxHash,
	})
	if (conflicting) {
		throw conflict('tx hash already linked to another checkout')
	}

	const existing = existingPaymentForCheckoutTx({
		repositories,
		checkoutId: checkout.id,
		chain: txChain,
		txHash: normalizedTxHash,
	})
	if (existing) {
		if (existing.status === 'confirmed') {
			return {
				payment: existing,
				verification: existing.verification,
				duplicate: true,
			}
		}

		const existingQuote =
			repositories.quotes.get(String(existing.quoteId || '')) || quote
		const existingRecipient =
			existing.recipientAddress ||
			checkout.recipientByChain?.[String(existingQuote.chain || '')] ||
			(chain ? checkout.recipientByChain?.[chain] : undefined) ||
			checkout.recipientAddress
		const verification = await verifyQuotePayment({
			providers,
			quote: existingQuote,
			recipientAddress: existingRecipient,
			txHash: normalizedTxHash,
			walletAddress: walletAddress || String(existing.walletAddress || ''),
		})

		const updated =
			repositories.payments.update(existing.id, {
				status: verification.ok ? 'confirmed' : 'pending',
				verification,
				walletAddress: walletAddress || existing.walletAddress || null,
			}) || existing

		if (verification.ok) {
			await confirmCheckoutIfNeeded({
				repositories,
				config,
				checkout,
				quote: existingQuote,
				payment: updated,
				chain: String(existingQuote.chain || ''),
			})
		}

		return { payment: updated, verification, duplicate: true }
	}

	const recipientAddress =
		checkout.recipientByChain?.[String(quote.chain || '')] ||
		(chain ? checkout.recipientByChain?.[chain] : undefined) ||
		checkout.recipientAddress
	const verification = await verifyQuotePayment({
		providers,
		quote,
		recipientAddress,
		txHash: normalizedTxHash,
		walletAddress,
	})

	const payment = repositories.payments.insert({
		checkoutId: checkout.id,
		quoteId: quote.id,
		txHash: normalizedTxHash,
		walletAddress: walletAddress || null,
		method: 'onchain',
		chain: quote.chain,
		asset: quote.asset,
		recipientAddress,
		status: verification.ok ? 'confirmed' : 'pending',
		verification,
	})

	if (verification.ok) {
		await confirmCheckoutIfNeeded({
			repositories,
			config,
			checkout,
			quote,
			payment,
			chain: String(quote.chain || ''),
		})
	}

	return { payment, verification }
}

async function reconcilePendingCheckoutPayments({
	repositories: providedRepositories,
	store,
	providers,
	config,
	checkout,
}: ReconcilePendingCheckoutPaymentsInput) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	if (!checkout || checkout.status === 'paid') return checkout

	const pendingPayments = repositories.payments.pendingOnchainForCheckout(
		checkout.id,
	)

	let latestCheckout = checkout
	for (const payment of pendingPayments) {
		const quote = repositories.quotes.get(String(payment.quoteId || ''))
		if (!quote) continue

		const recipientAddress =
			payment.recipientAddress ||
			checkout.recipientByChain?.[String(quote.chain || '')] ||
			(checkout.defaultChain
				? checkout.recipientByChain?.[checkout.defaultChain]
				: undefined) ||
			checkout.recipientAddress

		let verification: VerificationResult
		try {
			verification = await verifyQuotePayment({
				providers,
				quote,
				recipientAddress,
				txHash: String(payment.txHash || ''),
				walletAddress: payment.walletAddress
					? String(payment.walletAddress)
					: undefined,
			})
		} catch (error) {
			verification = {
				ok: false,
				reason: 'provider_error',
				message: error instanceof Error ? error.message : 'provider_error',
			}
		}

		const updated =
			repositories.payments.update(payment.id, {
				status: verification.ok ? 'confirmed' : 'pending',
				verification,
			}) || payment

		if (verification.ok) {
			latestCheckout = await confirmCheckoutIfNeeded({
				repositories,
				config,
				checkout: latestCheckout,
				quote,
				payment: updated,
				chain: String(quote.chain || ''),
			})
			break
		}
	}

	return repositories.checkouts.get(checkout.id) || latestCheckout
}

async function recordManualDetectedPayment({
	repositories: providedRepositories,
	store,
	config,
	checkout,
	quote,
	txHash,
	walletAddress,
	recipientAddress,
	observedAmountBaseUnits,
	tokenAddress,
	blockNumber,
	confirmations,
}: RecordManualDetectedPaymentInput) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	const normalizedTxHash = normalizeChainTxHash(txHash, String(quote.chain || ''))
	const conflicting = conflictingPaymentForTx({
		repositories,
		checkoutId: checkout.id,
		chain: String(quote.chain || ''),
		txHash: normalizedTxHash,
	})
	if (conflicting) throw conflict('tx hash already linked to another checkout')

	const existing = existingPaymentForCheckoutTx({
		repositories,
		checkoutId: checkout.id,
		chain: String(quote.chain || ''),
		txHash: normalizedTxHash,
	})
	const verification = {
		ok: true,
		manual: true,
		detection: 'deposit_address',
		confirmations: Number(confirmations || 0),
		observedAmountBaseUnits: String(observedAmountBaseUnits || ''),
		expectedAmountBaseUnits: quote.cryptoAmountBaseUnits,
		recipientAddress,
		tokenAddress: tokenAddress || null,
		senderAddress: walletAddress || null,
		blockNumber: Number(blockNumber || 0),
		reason: 'confirmed',
	}

	if (existing) {
		const updated =
			repositories.payments.update(existing.id, {
				walletAddress: walletAddress || existing.walletAddress || null,
				recipientAddress,
				chain: quote.chain,
				asset: quote.asset,
				status: 'confirmed',
				verification,
			}) || existing
		await confirmCheckoutIfNeeded({
			repositories,
			config,
			checkout,
			quote,
			payment: updated,
			chain: String(quote.chain || ''),
		})
		return updated
	}

	const payment = repositories.payments.insert({
		checkoutId: checkout.id,
		quoteId: quote.id,
		txHash: normalizedTxHash,
		walletAddress: walletAddress || null,
		method: 'manual',
		chain: quote.chain,
		asset: quote.asset,
		recipientAddress,
		status: 'confirmed',
		verification,
	})

	repositories.checkouts.update(checkout.id, { manualPaid: true })
	await confirmCheckoutIfNeeded({
		repositories,
		config,
		checkout,
		quote,
		payment,
		chain: String(quote.chain || ''),
	})
	return payment
}

async function recordConfirmedExternalPayment({
	repositories: providedRepositories,
	store,
	config,
	checkout,
	quote,
	txHash,
	walletAddress,
	recipientAddress,
	method = 'external',
	verification = {},
}: RecordConfirmedExternalPaymentInput) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	const normalizedTxHash = normalizeChainTxHash(txHash, String(quote.chain || ''))
	const conflicting = conflictingPaymentForTx({
		repositories,
		checkoutId: checkout.id,
		chain: String(quote.chain || ''),
		txHash: normalizedTxHash,
	})
	if (conflicting) throw conflict('tx hash already linked to another checkout')

	const existing = existingPaymentForCheckoutTx({
		repositories,
		checkoutId: checkout.id,
		chain: String(quote.chain || ''),
		txHash: normalizedTxHash,
	})
	const mergedVerification = {
		ok: true,
		reason: 'confirmed',
		...(verification as AnyRecord),
		recipientAddress,
		senderAddress:
			walletAddress || (verification as AnyRecord).senderAddress || null,
	}

	if (existing) {
		const updated =
			repositories.payments.update(existing.id, {
				walletAddress: walletAddress || existing.walletAddress || null,
				recipientAddress,
				chain: quote.chain,
				asset: quote.asset,
				method,
				status: 'confirmed',
				verification: mergedVerification,
			}) || existing
		await confirmCheckoutIfNeeded({
			repositories,
			config,
			checkout,
			quote,
			payment: updated,
			chain: String(quote.chain || ''),
		})
		return updated
	}

	const payment = repositories.payments.insert({
		checkoutId: checkout.id,
		quoteId: quote.id,
		txHash: normalizedTxHash,
		walletAddress: walletAddress || null,
		method,
		chain: quote.chain,
		asset: quote.asset,
		recipientAddress,
		status: 'confirmed',
		verification: mergedVerification,
	})

	await confirmCheckoutIfNeeded({
		repositories,
		config,
		checkout,
		quote,
		payment,
		chain: String(quote.chain || ''),
	})
	return payment
}

export {
	resetDispatchWebhookImplementation,
	verifyPaymentAndRecord,
	reconcilePendingCheckoutPayments,
	recordManualDetectedPayment,
	recordConfirmedExternalPayment,
	setDispatchWebhookImplementation,
}

class PaymentService {
	repositories: ServiceRepositories
	providers: ProviderRegistryLike
	config: AppConfig

	constructor({
		repositories,
		store,
		providers,
		config,
	}: PaymentServiceDependencies) {
		this.repositories = resolveServiceRepositories({ repositories, store })
		this.providers = providers
		this.config = config
	}

	async verifyPaymentAndRecord(input: {
		checkout: CheckoutLike
		quote: QuoteLike
		chain?: string
		txHash: string
		walletAddress?: string
	}) {
		return verifyPaymentAndRecord({
			repositories: this.repositories,
			providers: this.providers,
			config: this.config,
			...input,
		})
	}

	async reconcilePendingCheckoutPayments(checkout: CheckoutLike) {
		return reconcilePendingCheckoutPayments({
			repositories: this.repositories,
			providers: this.providers,
			config: this.config,
			checkout,
		})
	}

	async recordManualDetectedPayment(input: {
		checkout: CheckoutLike
		quote: QuoteLike
		txHash: string
		walletAddress?: string
		recipientAddress: string
		observedAmountBaseUnits: string
		tokenAddress?: string
		blockNumber?: number
		confirmations?: number
	}) {
		return recordManualDetectedPayment({
			repositories: this.repositories,
			config: this.config,
			...input,
		})
	}

	async recordConfirmedExternalPayment(input: {
		checkout: CheckoutLike
		quote: QuoteLike
		txHash: string
		walletAddress?: string | null
		recipientAddress: string
		method?: string
		verification?: AnyRecord
	}) {
		return recordConfirmedExternalPayment({
			repositories: this.repositories,
			config: this.config,
			...input,
		})
	}
}

export { PaymentService }
