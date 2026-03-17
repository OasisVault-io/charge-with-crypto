import { isExpired } from '../../utils/time'
import { notFound } from './appError'
import {
	type AnyRecord,
	type CollectionMap,
	type CollectionName,
	type InsertableRecord,
	type PatchRecord,
	type QuoteRecord,
	type Repository,
	type StoreLike,
} from './types'

class CollectionRepository<C extends CollectionName>
	implements Repository<CollectionMap[C]>
{
	store: StoreLike
	collection: C

	constructor(store: StoreLike, collection: C) {
		this.store = store
		this.collection = collection
	}

	get(id: string): CollectionMap[C] | null {
		return this.store.getById(this.collection, id)
	}

	require(
		id: string,
		errorFactory: (() => Error) | null = null,
	): CollectionMap[C] {
		const record = this.get(id)
		if (!record) {
			throw errorFactory?.() || notFound(`${this.collection} record not found`)
		}
		return record
	}

	list(): CollectionMap[C][] {
		return this.store.list(this.collection)
	}

	find(predicate: (item: CollectionMap[C]) => boolean): CollectionMap[C][] {
		return this.store.find(this.collection, predicate)
	}

	findOne(
		predicate: (item: CollectionMap[C]) => boolean,
	): CollectionMap[C] | null {
		return this.store.findOne
			? this.store.findOne(this.collection, predicate)
			: this.find(predicate)[0] || null
	}

	insert(item: InsertableRecord<CollectionMap[C]>): CollectionMap[C] {
		return this.store.insert(this.collection, item)
	}

	update(
		id: string,
		patch: PatchRecord<CollectionMap[C]>,
	): CollectionMap[C] | null {
		return this.store.update(this.collection, id, patch)
	}
}

class MerchantsRepository extends CollectionRepository<'merchants'> {}

class ProductsRepository extends CollectionRepository<'products'> {
	activeList(merchantId = '') {
		return this.list()
			.filter((product) => product.active !== false)
			.filter((product) =>
				merchantId ? product.merchantId === merchantId : true,
			)
	}
}

class CheckoutsRepository extends CollectionRepository<'checkouts'> {
	byMerchant(merchantId: string) {
		return this.find((checkout) => checkout.merchantId === merchantId)
	}
}

class QuotesRepository extends CollectionRepository<'quotes'> {
	forCheckout(checkoutId: string) {
		return this.find((quote) => quote.checkoutId === checkoutId)
	}

	latestForCheckoutRoutes(checkoutId: string) {
		const latestByRoute = new Map<string, QuoteRecord>()
		for (const quote of this.forCheckout(checkoutId)) {
			const routeKey = `${quote.chain}:${quote.asset}`
			const current = latestByRoute.get(routeKey)
			if (
				!current ||
				new Date(String(quote.createdAt || '')).getTime() >
					new Date(String(current.createdAt || '')).getTime()
			) {
				latestByRoute.set(routeKey, quote)
			}
		}
		return [...latestByRoute.values()]
	}

	activeForCheckout(checkoutId: string, now = new Date()) {
		const active: QuoteRecord[] = []
		for (const quote of this.latestForCheckoutRoutes(checkoutId)) {
			if (quote.expiresAt && isExpired(quote.expiresAt, now)) {
				if (quote.status !== 'expired') {
					this.update(quote.id, { status: 'expired' })
				}
				continue
			}
			active.push(quote)
		}
		return active.sort((a, b) =>
			`${String(a.chain)}:${String(a.asset)}`.localeCompare(
				`${String(b.chain)}:${String(b.asset)}`,
			),
		)
	}

	activeForSelection(
		checkoutId: string,
		selection: string | AnyRecord | null = null,
		now = new Date(),
	) {
		const active = this.activeForCheckout(checkoutId, now)
		if (!selection) return active[0] || null
		if (typeof selection === 'string') {
			return active.find((quote) => quote.chain === selection) || null
		}
		return (
			active.find((quote) => {
				if (selection.chain && quote.chain !== selection.chain) return false
				if (selection.asset && quote.asset !== selection.asset) return false
				return true
			}) || null
		)
	}

	forCheckoutById(checkoutId: string, quoteId: string) {
		if (!quoteId) return null
		const quote = this.get(quoteId)
		if (!quote || quote.checkoutId !== checkoutId) return null
		return quote
	}

	latestForSelection(checkoutId: string, selection: AnyRecord = {}) {
		const quotes = this.forCheckout(checkoutId).filter((quote) => {
			if (selection.chain && quote.chain !== selection.chain) return false
			if (selection.asset && quote.asset !== selection.asset) return false
			return true
		})
		if (!quotes.length) return null
		return [...quotes].sort(
			(a, b) =>
				new Date(String(b.createdAt || '')).getTime() -
				new Date(String(a.createdAt || '')).getTime(),
		)[0]
	}
}

class PaymentsRepository extends CollectionRepository<'payments'> {
	forCheckout(checkoutId: string) {
		return this.find((payment) => payment.checkoutId === checkoutId)
	}

	pendingOnchainForCheckout(checkoutId: string) {
		return this.forCheckout(checkoutId).filter(
			(payment) =>
				payment.method === 'onchain' &&
				payment.status !== 'confirmed' &&
				Boolean(payment.txHash),
		)
	}

	confirmedForCheckout(checkoutId: string) {
		return (
			this.forCheckout(checkoutId).find(
				(payment) => payment.status === 'confirmed',
			) || null
		)
	}

	findByCheckoutChainTx(checkoutId: string, chain: string, txHash: string) {
		return (
			this.find(
				(payment) =>
					payment.checkoutId === checkoutId &&
					payment.chain === chain &&
					String(payment.txHash || '').toLowerCase() === txHash,
			)[0] || null
		)
	}

	findConflictingChainTx(checkoutId: string, chain: string, txHash: string) {
		return (
			this.find(
				(payment) =>
					payment.checkoutId !== checkoutId &&
					payment.chain === chain &&
					String(payment.txHash || '').toLowerCase() === txHash,
			)[0] || null
		)
	}
}

class EventsRepository extends CollectionRepository<'events'> {
	forMerchantOrCheckoutIds(merchantId: string, checkoutIds: Set<string>) {
		return this.find(
			(event) =>
				event.merchantId === merchantId ||
				checkoutIds.has(String(event.checkoutId || '')),
		)
	}
}

class WebhookDeliveriesRepository extends CollectionRepository<'webhook_deliveries'> {
	forMerchantOrEventIds(merchantId: string, eventIds: Set<string>) {
		return this.find(
			(delivery) =>
				delivery.merchantId === merchantId ||
				eventIds.has(String(delivery.eventId || '')),
		)
	}
}

class IdempotencyKeysRepository extends CollectionRepository<'idempotency_keys'> {
	findByKeyScope(key: string, scope: string) {
		return this.findOne(
			(entry) => entry.key === key && entry.scope === scope,
		)
	}
}

class CountersRepository extends CollectionRepository<'counters'> {
	getValue(id: string) {
		return this.get(id)
	}
}

type ServiceRepositories = {
	store: StoreLike
	merchants: MerchantsRepository
	products: ProductsRepository
	checkouts: CheckoutsRepository
	quotes: QuotesRepository
	payments: PaymentsRepository
	events: EventsRepository
	webhookDeliveries: WebhookDeliveriesRepository
	idempotencyKeys: IdempotencyKeysRepository
	counters: CountersRepository
}

function isServiceRepositories(
	value: ServiceRepositories | StoreLike,
): value is ServiceRepositories {
	return 'store' in value && 'merchants' in value && 'quotes' in value
}

function createServiceRepositories(store: StoreLike): ServiceRepositories {
	return {
		store,
		merchants: new MerchantsRepository(store, 'merchants'),
		products: new ProductsRepository(store, 'products'),
		checkouts: new CheckoutsRepository(store, 'checkouts'),
		quotes: new QuotesRepository(store, 'quotes'),
		payments: new PaymentsRepository(store, 'payments'),
		events: new EventsRepository(store, 'events'),
		webhookDeliveries: new WebhookDeliveriesRepository(
			store,
			'webhook_deliveries',
		),
		idempotencyKeys: new IdempotencyKeysRepository(store, 'idempotency_keys'),
		counters: new CountersRepository(store, 'counters'),
	}
}

function repositoriesFrom(
	value: ServiceRepositories | StoreLike,
): ServiceRepositories {
	return isServiceRepositories(value) ? value : createServiceRepositories(value)
}

function resolveServiceRepositories({
	repositories,
	store,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
}): ServiceRepositories {
	if (repositories) return repositories
	if (store) return createServiceRepositories(store)
	throw new Error('repositories or store is required')
}

export {
	CheckoutsRepository,
	CollectionRepository,
	CountersRepository,
	createServiceRepositories,
	EventsRepository,
	IdempotencyKeysRepository,
	MerchantsRepository,
	PaymentsRepository,
	ProductsRepository,
	QuotesRepository,
	repositoriesFrom,
	resolveServiceRepositories,
	WebhookDeliveriesRepository,
}

export type { ServiceRepositories }
