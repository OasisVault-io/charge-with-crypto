import QRCode from 'qrcode'
import { nowIso } from '../../utils/time'
import { normalizeAddress } from '../../utils/validation'
import {
	createViemScannerProvider,
	createViemWalletClient,
	deriveEvmDepositWallet,
	encodeErc20TransferData,
	sponsorAddressForPrivateKey,
} from '../../utils/viemEvm.js'
import { requestJson } from '../merchant/merchantWebhookClient'
import { recordManualDetectedPayment } from '../payments/paymentService'
import { getActiveQuotesForCheckout } from '../payments/quoteService'
import { isFixedPegAsset } from '../pricing/priceSupport'
import {
	type AnyRecord,
	type AppConfig,
	type CheckoutLike,
	type CounterLike,
	type DerivedWalletLike,
	type EvmProviderLike,
	type FeeDataLike,
	type ManualPaymentLike,
	type MerchantLike,
	type PaymentLike,
	type QuoteLike,
	type StoreLike,
	type TransferLogLike,
	type WalletClientLike,
} from '../shared/types.js'
import { ManualPaymentAllocator } from './manualPaymentAllocator'
import { ManualPaymentPresenter } from './manualPaymentPresenter'
import { ManualPaymentScanner } from './manualPaymentScanner'
import { ManualPaymentSweeper } from './manualPaymentSweeper'

type ProviderEntry = {
	chain: string
	chainConfig: AnyRecord
	rpcUrl: string
	wrapper: EvmProviderLike | null
	getBlockNumber?: () => Promise<bigint>
}

type ChainConfigLike = {
	rpcUrlEnv?: string
}

type SweepFeeOverrides = {
	unitPrice: bigint
	tx: Record<string, bigint | number | string>
}

type LogRecoveryResult =
	| {
			ok: true
			logs: TransferLogLike[]
			toBlock: number
			latestBlock: number
			confirmedToBlock: number
	  }
	| {
			ok: false
			wait: boolean
			error: Error
			latestBlock: number
			confirmedToBlock: number
	  }

type ExternalSweepRequestInput = {
	payment: PaymentLike
	checkout: CheckoutLike
	chain: string
	derivationIndex: number
	fromAddress: string
	treasuryAddress: string
	tokenAddress: string
	tokenBalance: bigint
	gasLimit: bigint
	feeOverrides: SweepFeeOverrides
}

const TRANSFER_TOPIC =
	'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const CHAIN_PREFERENCE = ['base', 'arbitrum', 'polygon', 'ethereum']
const ASSET_PREFERENCE = ['USDC', 'USDT', 'ETH']

function uniq<T>(values: T[] | null | undefined): T[] {
	return [...new Set((values || []).filter(Boolean))] as T[]
}

function topicAddress(topic: string | null | undefined) {
	return `0x${String(topic || '').slice(-40)}`.toLowerCase()
}

function topicForAddress(address: string) {
	return `0x${normalizeAddress(address).replace(/^0x/, '').padStart(64, '0')}`
}

function routeScore(quote: Pick<QuoteLike, 'asset' | 'chain'>) {
	const assetIndex = ASSET_PREFERENCE.indexOf(quote.asset)
	const chainIndex = CHAIN_PREFERENCE.indexOf(quote.chain)
	return (
		(assetIndex === -1 ? 99 : assetIndex) * 10 +
		(chainIndex === -1 ? 99 : chainIndex)
	)
}

function sortLogs(logs: TransferLogLike[]) {
	return [...logs].sort((a, b) => {
		if (a.blockNumber !== b.blockNumber)
			return Number(a.blockNumber) - Number(b.blockNumber)
		return (
			Number(a.index || a.logIndex || 0) - Number(b.index || b.logIndex || 0)
		)
	})
}

function hexDataToBigInt(value: string | null | undefined) {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized || normalized === '0x') return 0n
	return BigInt(normalized)
}

function checkoutCreatedAtMs(checkout: CheckoutLike) {
	const value = Date.parse(String(checkout?.createdAt || ''))
	return Number.isFinite(value) ? value : 0
}

function manualBalanceSnapshot(
	manualPayment: ManualPaymentLike | null | undefined,
	chain: string,
	asset: string,
) {
	const snapshot = manualPayment?.balanceSnapshot?.[chain]?.[asset]
	if (snapshot == null || snapshot === '') return 0n
	try {
		return BigInt(String(snapshot))
	} catch {
		return 0n
	}
}

class ManualPaymentService {
	store: StoreLike
	config: AppConfig
	xpub: string
	mnemonic: string
	derivationPath: string
	sweepSignerUrl: string
	sweepSignerSecret: string
	sponsorPrivateKey: string
	scanIntervalMs: number
	scanBlockWindow: number
	providers: Map<string, ProviderEntry>
	timer: ReturnType<typeof setInterval> | null
	running: boolean
	counterLock: Promise<void>
	derivationMode: 'xpub' | 'mnemonic' | 'disabled'
	sweepMode: 'external_signer' | 'local' | 'manual'
	sponsorAddress: string
	ready: Promise<void>
	allocator: ManualPaymentAllocator
	presenter: ManualPaymentPresenter
	scanner: ManualPaymentScanner
	sweeper: ManualPaymentSweeper
	requestExternalSweep: (input: ExternalSweepRequestInput) => Promise<{
		txHash: string
		fundingTxHash: string
	}>

	constructor({ store, config }: { store: StoreLike; config: AppConfig }) {
		this.store = store
		this.config = config
		this.xpub = String(config.manualPaymentXpub || '').trim()
		this.mnemonic = String(config.manualPaymentMnemonic || '').trim()
		this.derivationPath = String(
			config.manualPaymentDerivationPath || "m/44'/60'/0'/0",
		).trim()
		this.sweepSignerUrl = String(
			config.manualPaymentSweepSignerUrl || '',
		).trim()
		this.sweepSignerSecret = String(
			config.manualPaymentSweepSignerSecret || '',
		).trim()
		this.sponsorPrivateKey = String(
			config.manualPaymentSweepSponsorPrivateKey || '',
		).trim()
		this.scanIntervalMs = Math.max(
			5000,
			Number(config.manualPaymentScanIntervalMs || 15000),
		)
		this.scanBlockWindow = Math.max(
			20,
			Number(config.manualPaymentScanBlockWindow || 250),
		)
		this.providers = new Map()
		this.timer = null
		this.running = false
		this.counterLock = Promise.resolve()
		this.derivationMode = this.xpub
			? 'xpub'
			: this.mnemonic
				? 'mnemonic'
				: 'disabled'
		this.sweepMode = this.sweepSignerUrl
			? 'external_signer'
			: this.mnemonic && this.sponsorPrivateKey
				? 'local'
				: 'manual'
		this.sponsorAddress = ''
		this.ready =
			this.sweepMode === 'local' && this.sponsorPrivateKey
				? sponsorAddressForPrivateKey(this.sponsorPrivateKey)
						.then((address) => {
							this.sponsorAddress = address
						})
						.catch(() => {})
				: Promise.resolve()
		this.allocator = new ManualPaymentAllocator({
			createManualPayment: (input) =>
				this.createCheckoutManualPaymentInternal(input),
		})
		this.presenter = new ManualPaymentPresenter({
			readStatus: () => this.buildStatus(),
			readCheckoutDetails: (checkout) =>
				this.getCheckoutDetailsInternal(checkout),
		})
		this.scanner = new ManualPaymentScanner({
			reconcile: (checkout) => this.reconcileCheckoutInternal(checkout),
			scan: (checkout, chain, quotes) =>
				this.scanChainForCheckoutInternal(checkout, chain, quotes),
			recoverLogs: (input) =>
				this.getLogsWithRangeRecoveryInternal(
					input as Parameters<
						ManualPaymentService['getLogsWithRangeRecoveryInternal']
					>[0],
				) as Promise<Record<string, unknown>>,
			run: () => this.runCycleInternal(),
		})
		this.sweeper = new ManualPaymentSweeper({
			processQueue: () => this.processSweepQueueInternal(),
			sweepOne: (payment) => this.sweepPaymentInternal(payment),
			buildFeeOverrides: (feeData) => this.feeOverridesInternal(feeData),
		})

		for (const [chain, chainConfig] of Object.entries(config.chains) as Array<
			[string, ChainConfigLike]
		>) {
			if (!chainConfig.rpcUrlEnv) continue
			const endpoint = process.env[chainConfig.rpcUrlEnv]
			if (!endpoint) continue
			this.providers.set(chain, {
				chain,
				chainConfig: chainConfig as AnyRecord,
				rpcUrl: endpoint,
				wrapper: null,
			})
		}
	}

	isConfigured() {
		return Boolean((this.xpub || this.mnemonic) && this.providers.size)
	}

	status() {
		return this.presenter.status()
	}

	buildStatus() {
		return {
			configured: this.isConfigured(),
			derivationMode: this.derivationMode,
			sweepMode: this.sweepMode,
			sponsorAddress: this.sponsorAddress || '',
			derivationPath: this.derivationPath,
		}
	}

	async provider(chain: string): Promise<EvmProviderLike> {
		const provider = this.providers.get(chain)
		if (!provider) throw new Error(`missing manual payment rpc for ${chain}`)
		if (provider.wrapper) return provider.wrapper
		if (typeof provider.getBlockNumber === 'function')
			return provider as unknown as EvmProviderLike
		if (!provider.wrapper) {
			provider.wrapper = (await createViemScannerProvider({
				chain,
				chainConfig: provider.chainConfig,
				rpcUrl: provider.rpcUrl,
			})) as EvmProviderLike
		}
		return provider.wrapper
	}

	async deriveWallet(index: number): Promise<DerivedWalletLike> {
		await this.ready
		return (await deriveEvmDepositWallet({
			xpub: this.xpub,
			mnemonic: this.mnemonic,
			derivationPath: this.derivationPath,
			index,
		})) as DerivedWalletLike
	}

	canAutoSweep() {
		return this.sweepMode === 'local' || this.sweepMode === 'external_signer'
	}

	pendingSweepStatus() {
		return this.canAutoSweep() ? 'queued' : 'manual_required'
	}

	nextDerivationIndexFromCheckouts() {
		const indexes = (
			this.store.find('checkouts', (checkout) =>
				Number.isInteger(
					(checkout as CheckoutLike).manualPayment?.derivationIndex,
				),
			) as CheckoutLike[]
		)
			.map((checkout) => Number(checkout.manualPayment?.derivationIndex))
			.filter((value) => Number.isInteger(value) && value >= 0)
		const startIndex = Math.max(
			0,
			Number(this.config.manualPaymentStartIndex || 0),
		)
		return indexes.length
			? Math.max(startIndex, Math.max(...indexes) + 1)
			: startIndex
	}

	async reserveDerivationIndex() {
		const pending = this.counterLock
		let release: (() => void) | undefined
		this.counterLock = new Promise((resolve) => {
			release = resolve
		})
		await pending
		try {
			const startIndex = Math.max(
				0,
				Number(this.config.manualPaymentStartIndex || 0),
			)
			const existing = this.store.getById(
				'counters',
				'manual_payment_derivation_index',
			) as CounterLike | null
			if (existing) {
				const index = Math.max(startIndex, Number(existing.value || 0))
				this.store.update('counters', existing.id, { value: index + 1 })
				return index
			}
			const index = this.nextDerivationIndexFromCheckouts()
			this.store.insert('counters', {
				id: 'manual_payment_derivation_index',
				value: index + 1,
			})
			return index
		} finally {
			release?.()
		}
	}

	merchantEnabledChains(
		merchant: MerchantLike,
		checkout: CheckoutLike,
	): string[] {
		const globallyAllowedChains = uniq<string>(
			(this.config.manualPaymentAllowedChains || []) as string[],
		).filter((chain) => this.config.chains[chain])
		const merchantChains = uniq<string>(
			(merchant?.manualPaymentEnabledChains ||
				merchant?.enabledChains ||
				[]) as string[],
		)
		const checkoutChains = uniq<string>(
			(checkout?.enabledChains || []) as string[],
		)
		return merchantChains.filter(
			(chain) =>
				checkoutChains.includes(chain) &&
				this.config.chains[chain] &&
				(!globallyAllowedChains.length ||
					globallyAllowedChains.includes(chain)),
		)
	}

	manualQuotes(checkout: CheckoutLike, quotes: QuoteLike[]): QuoteLike[] {
		const manualPayment = checkout.manualPayment || {}
		const allowedChains = new Set(manualPayment.enabledChains || [])
		const allowedAssets = new Set(manualPayment.acceptedAssets || [])
		return (quotes || []).filter(
			(quote) =>
				allowedChains.has(quote.chain) &&
				allowedAssets.has(quote.asset) &&
				isFixedPegAsset(quote.asset),
		)
	}

	preferredQuote(
		checkout: CheckoutLike,
		quotes: QuoteLike[],
	): QuoteLike | null {
		const candidates = this.manualQuotes(checkout, quotes)
		return candidates.sort((a, b) => routeScore(a) - routeScore(b))[0] || null
	}

	async createCheckoutManualPayment({
		merchant,
		checkout,
		quotes,
	}: {
		merchant: MerchantLike
		checkout: CheckoutLike
		quotes: QuoteLike[]
	}): Promise<ManualPaymentLike> {
		return this.allocator.createCheckoutManualPayment({
			merchant,
			checkout,
			quotes,
		})
	}

	async createCheckoutManualPaymentInternal({
		merchant,
		checkout,
		quotes,
	}: {
		merchant: MerchantLike
		checkout: CheckoutLike
		quotes: QuoteLike[]
	}): Promise<ManualPaymentLike> {
		await this.ready
		const enabledChains = this.merchantEnabledChains(merchant, checkout).filter(
			(chain) => this.providers.has(chain),
		)
		const acceptedAssets = uniq(
			(quotes || [])
				.filter(
					(quote) =>
						enabledChains.includes(quote.chain) && isFixedPegAsset(quote.asset),
				)
				.map((quote) => quote.asset),
		)
		const supportedChains = uniq(
			(quotes || [])
				.filter(
					(quote) =>
						enabledChains.includes(quote.chain) &&
						acceptedAssets.includes(quote.asset),
				)
				.map((quote) => quote.chain),
		)

		if (!supportedChains.length || !acceptedAssets.length) {
			return {
				available: false,
				status: 'disabled',
				reason:
					'Manual pay is only available for fixed stablecoin routes enabled by the merchant.',
				enabledChains: [],
				acceptedAssets: [],
			}
		}

		if (!this.isConfigured()) {
			return {
				available: false,
				status: 'disabled',
				reason: 'Manual pay engine is not configured on the server.',
				enabledChains: supportedChains,
				acceptedAssets,
			}
		}

		const derivationIndex = await this.reserveDerivationIndex()
		const wallet = await this.deriveWallet(derivationIndex)
		const initializedAt = nowIso()
		const supportedRoutes = (quotes || []).filter(
			(quote) =>
				supportedChains.includes(quote.chain) &&
				acceptedAssets.includes(quote.asset),
		)
		const scanStateEntries = await Promise.all(
			supportedChains.map(async (chain: string) => {
				try {
					const provider = await this.provider(chain)
					const latestBlock = await provider.getBlockNumber()
					return [
						chain,
						{
							latestBlock,
							nextBlock: Math.max(0, Number(latestBlock) + 1),
							lastScannedBlock: null,
							initializedAt,
						},
					]
				} catch (err) {
					return [
						chain,
						{
							nextBlock: null,
							lastScannedBlock: null,
							initializedAt,
							error: err.message,
						},
					]
				}
			}),
		)
		const scanState = Object.fromEntries(scanStateEntries)
		const balanceSnapshotEntries = await Promise.all(
			supportedChains.map(async (chain) => {
				const provider = await this.provider(chain).catch(() => null)
				if (!provider || typeof provider.readErc20Balance !== 'function')
					return [chain, {}]
				const routeAssets = uniq(
					supportedRoutes
						.filter((quote) => quote.chain === chain)
						.map((quote) => quote.asset),
				)
				const assetBalances: Record<string, string> = {}
				for (const asset of routeAssets as string[]) {
					const assetConfig = this.config.assets?.[asset] as
						| AnyRecord
						| undefined
					const addresses = assetConfig?.addresses as
						| Record<string, string>
						| undefined
					const tokenAddress = addresses?.[chain as string]
					if (!tokenAddress) continue
					try {
						const balance = await provider.readErc20Balance({
							tokenAddress: normalizeAddress(tokenAddress),
							owner: wallet.address,
						})
						assetBalances[asset] = balance.toString()
					} catch {
						assetBalances[asset] = '0'
					}
				}
				return [chain, assetBalances]
			}),
		)
		const balanceSnapshot = Object.fromEntries(balanceSnapshotEntries)

		return {
			available: true,
			status: 'awaiting_payment',
			derivationIndex,
			address: wallet.address,
			enabledChains: supportedChains,
			acceptedAssets,
			scanState,
			balanceSnapshot,
			sweepStatus: 'idle',
			sponsorAddress: this.sponsorAddress || '',
		}
	}

	async getCheckoutDetails(checkout: CheckoutLike) {
		return this.presenter.getCheckoutDetails(checkout)
	}

	async getCheckoutDetailsInternal(checkout: CheckoutLike) {
		const manualPayment = checkout?.manualPayment
		if (!manualPayment?.available || !manualPayment.address)
			return { available: false }
		const quotes = getActiveQuotesForCheckout(this.store, checkout.id)
		const preferredQuote = this.preferredQuote(checkout, quotes)
		const qrSvg = await QRCode.toString(manualPayment.address, {
			type: 'svg',
			margin: 0,
			color: { dark: '#27fa7b', light: '#0000' },
		})

		return {
			available: true,
			address: manualPayment.address,
			enabledChains: manualPayment.enabledChains || [],
			acceptedAssets: manualPayment.acceptedAssets || [],
			status: manualPayment.status || 'awaiting_payment',
			detectedChain: manualPayment.detectedChain || '',
			detectedAsset: manualPayment.detectedAsset || '',
			detectedTxHash: manualPayment.detectedTxHash || '',
			qrSvg,
			preferredQuote: preferredQuote
				? {
						id: preferredQuote.id,
						chain: preferredQuote.chain,
						asset: preferredQuote.asset,
						cryptoAmount: preferredQuote.cryptoAmount,
						cryptoAmountBaseUnits: preferredQuote.cryptoAmountBaseUnits,
					}
				: null,
		}
	}

	async reconcileCheckout(checkout: CheckoutLike): Promise<CheckoutLike> {
		return this.scanner.reconcileCheckout(checkout)
	}

	async reconcileCheckoutInternal(checkout: CheckoutLike): Promise<CheckoutLike> {
		if (!checkout?.manualPayment?.available || checkout.status === 'paid')
			return checkout
		const quotes = getActiveQuotesForCheckout(this.store, checkout.id)
		const candidateQuotes = this.manualQuotes(checkout, quotes)
		if (!candidateQuotes.length) return checkout

		const quotesByChain = new Map()
		for (const quote of candidateQuotes) {
			if (!quotesByChain.has(quote.chain)) quotesByChain.set(quote.chain, [])
			quotesByChain.get(quote.chain).push(quote)
		}

		let latestCheckout = checkout
		for (const [chain, chainQuotes] of quotesByChain.entries()) {
			try {
				latestCheckout = await this.scanChainForCheckout(
					latestCheckout,
					chain,
					chainQuotes,
				)
			} catch (err) {
				const manualPayment = latestCheckout?.manualPayment || {}
				const scanState = { ...(manualPayment.scanState || {}) }
				scanState[chain] = {
					...(scanState[chain] || {}),
					lastScanAt: nowIso(),
					error: err.message,
				}
				this.store.update('checkouts', latestCheckout.id, {
					manualPayment: {
						...manualPayment,
						scanState,
						lastScanError: err.message,
					},
				})
				latestCheckout =
					(this.store.getById(
						'checkouts',
						latestCheckout.id,
					) as CheckoutLike | null) || latestCheckout
			}
			if (latestCheckout.status === 'paid') break
		}

		return (
			(this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
			latestCheckout
		)
	}

	async scanChainForCheckout(
		checkout: CheckoutLike,
		chain: string,
		quotes: QuoteLike[],
	): Promise<CheckoutLike> {
		return this.scanner.scanChainForCheckout(checkout, chain, quotes)
	}

	async scanChainForCheckoutInternal(
		checkout: CheckoutLike,
		chain: string,
		quotes: QuoteLike[],
	): Promise<CheckoutLike> {
		const manualPayment = checkout.manualPayment || {}
		const scanState = { ...(manualPayment.scanState || {}) }
		const chainState = { ...(scanState[chain] || {}) }
		const provider = await this.provider(chain)
		const createdAtMs = checkoutCreatedAtMs(checkout)
		let latestBlock
		try {
			latestBlock = await provider.getBlockNumber()
		} catch (err) {
			scanState[chain] = {
				...chainState,
				lastScanAt: nowIso(),
				error: err.message,
			}
			this.store.update('checkouts', checkout.id, {
				manualPayment: {
					...manualPayment,
					scanState,
					lastScanError: err.message,
				},
			})
			return (
				(this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
				checkout
			)
		}
		let confirmedToBlock = Math.max(
			0,
			latestBlock - Math.max(0, this.config.minConfirmations - 1),
		)

		let fromBlock = Number.isInteger(chainState.nextBlock)
			? Number(chainState.nextBlock)
			: null
		// For a freshly-created checkout, start watching only after the current head
		// instead of looking back into recent history. This avoids treating transfers
		// already present in the current head block as payment for a brand-new checkout.
		if (fromBlock == null) fromBlock = Math.max(0, latestBlock + 1)
		if (fromBlock > confirmedToBlock) {
			scanState[chain] = { ...chainState, latestBlock, nextBlock: fromBlock }
			this.store.update('checkouts', checkout.id, {
				manualPayment: { ...manualPayment, scanState },
			})
			return (
				(this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
				checkout
			)
		}

		let scanToBlock = Math.min(
			confirmedToBlock,
			fromBlock + this.scanBlockWindow - 1,
		)
		const addressTopic = topicForAddress(manualPayment.address)
		const candidates = []
		let finalLastScannedBlock = scanToBlock
		let finalNextBlock = scanToBlock + 1

		for (const quote of quotes) {
			const assetConfig = this.config.assets[quote.asset]
			const tokenAddress = assetConfig?.addresses?.[chain]
				? normalizeAddress(assetConfig.addresses[chain])
				: ''
			if (!tokenAddress) continue
			if (typeof provider.readErc20Balance === 'function') {
				let currentBalance = null
				try {
					currentBalance = await provider.readErc20Balance({
						tokenAddress,
						owner: manualPayment.address,
					})
				} catch {
					currentBalance = null
				}
				if (currentBalance != null) {
					const baselineBalance = manualBalanceSnapshot(
						manualPayment,
						chain,
						quote.asset,
					)
					const expectedAmountBaseUnits = BigInt(quote.cryptoAmountBaseUnits)
					if (
						BigInt(currentBalance) - baselineBalance <
						expectedAmountBaseUnits
					)
						continue
				}
			}
			const logResult = await this.getLogsWithRangeRecovery({
				provider,
				tokenAddress,
				addressTopic,
				fromBlock,
				toBlock: scanToBlock,
				latestBlock,
				confirmedToBlock,
			})
			latestBlock = logResult.latestBlock
			confirmedToBlock = logResult.confirmedToBlock
			if (!logResult.ok) {
				scanState[chain] = {
					...chainState,
					latestBlock,
					nextBlock: fromBlock,
					lastScanAt: nowIso(),
				}
				if ('wait' in logResult && logResult.wait) {
					delete scanState[chain].error
				} else {
					scanState[chain].error =
						('error' in logResult ? logResult.error.message : '') ||
						'manual_payment_log_scan_failed'
				}
				this.store.update('checkouts', checkout.id, {
					manualPayment: { ...manualPayment, scanState },
				})
				return (
					(this.store.getById(
						'checkouts',
						checkout.id,
					) as CheckoutLike | null) || checkout
				)
			}
			const logs = logResult.logs
			scanToBlock = logResult.toBlock
			finalLastScannedBlock = scanToBlock
			finalNextBlock = scanToBlock + 1
			for (const log of sortLogs(logs)) {
				const observedAmountBaseUnits = hexDataToBigInt(log.data)
				const expectedAmountBaseUnits = BigInt(quote.cryptoAmountBaseUnits)
				if (observedAmountBaseUnits < expectedAmountBaseUnits) continue
				let blockTimestampMs = 0
				if (createdAtMs) {
					try {
						const block = await provider.getBlock({
							blockNumber: log.blockNumber,
						})
						blockTimestampMs = Number(block?.timestamp || 0) * 1000
					} catch {
						continue
					}
					if (!blockTimestampMs || blockTimestampMs < createdAtMs) continue
				}
				candidates.push({
					quote,
					tokenAddress,
					txHash: log.transactionHash,
					blockNumber: Number(log.blockNumber),
					blockTimestampMs,
					observedAmountBaseUnits,
					fromAddress: topicAddress(log.topics?.[1]),
				})
			}
		}

		scanState[chain] = {
			...chainState,
			latestBlock,
			lastScannedBlock: finalLastScannedBlock,
			nextBlock: finalNextBlock,
			lastScanAt: nowIso(),
		}
		delete scanState[chain].error

		if (!candidates.length) {
			this.store.update('checkouts', checkout.id, {
				manualPayment: { ...manualPayment, scanState },
			})
			return (
				(this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
				checkout
			)
		}

		const detected = candidates.sort((a, b) => {
			if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
			return routeScore(a.quote) - routeScore(b.quote)
		})[0]

		let payment
		try {
			payment = await recordManualDetectedPayment({
				store: this.store,
				config: this.config,
				checkout,
				quote: detected.quote,
				txHash: detected.txHash,
				walletAddress: detected.fromAddress,
				recipientAddress: manualPayment.address,
				observedAmountBaseUnits: detected.observedAmountBaseUnits.toString(),
				tokenAddress: detected.tokenAddress,
				blockNumber: detected.blockNumber,
				confirmations: Math.max(1, latestBlock - detected.blockNumber + 1),
			})
		} catch (err) {
			this.store.update('checkouts', checkout.id, {
				manualPayment: {
					...manualPayment,
					scanState,
					lastScanError: err.message,
					lastScanAt: nowIso(),
				},
			})
			return (
				(this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
				checkout
			)
		}
		let sweep = payment.sweep || null
		if (!sweep || !sweep.status) {
			sweep = {
				status: this.pendingSweepStatus(),
				mode: this.sweepMode,
				updatedAt: nowIso(),
			}
			payment = this.store.update('payments', payment.id, { sweep })
		}

		this.store.update('checkouts', checkout.id, {
			manualPayment: {
				...manualPayment,
				status: 'payment_detected',
				detectedAt: nowIso(),
				detectedChain: detected.quote.chain,
				detectedAsset: detected.quote.asset,
				detectedTxHash: detected.txHash,
				detectedAmountBaseUnits: detected.observedAmountBaseUnits.toString(),
				scanState,
				sweepStatus:
					sweep.status ||
					manualPayment.sweepStatus ||
					this.pendingSweepStatus(),
			},
		})

		return (
			(this.store.getById('checkouts', checkout.id) as CheckoutLike | null) ||
			checkout
		)
	}

	async getLogsWithRangeRecovery(input: {
		provider: EvmProviderLike
		tokenAddress: string
		addressTopic: string
		fromBlock: number
		toBlock: number
		latestBlock: number
		confirmedToBlock: number
	}): Promise<LogRecoveryResult> {
		return this.scanner.getLogsWithRangeRecovery(
			input as unknown as Record<string, unknown>,
		) as Promise<LogRecoveryResult>
	}

	async getLogsWithRangeRecoveryInternal({
		provider,
		tokenAddress,
		addressTopic,
		fromBlock,
		toBlock,
		latestBlock,
		confirmedToBlock,
	}: {
		provider: EvmProviderLike
		tokenAddress: string
		addressTopic: string
		fromBlock: number
		toBlock: number
		latestBlock: number
		confirmedToBlock: number
	}): Promise<LogRecoveryResult> {
		let rangeEnd = toBlock
		let observedLatestBlock = latestBlock
		let observedConfirmedToBlock = confirmedToBlock
		let lastError: Error | null = null

		for (let attempt = 0; attempt < 4; attempt += 1) {
			try {
				if (typeof provider.getLogs !== 'function') {
					throw new Error('provider_missing_get_logs')
				}
				const logs = await provider.getLogs({
					address: tokenAddress,
					topics: [TRANSFER_TOPIC, null, addressTopic],
					fromBlock,
					toBlock: rangeEnd,
				})
				return {
					ok: true,
					logs,
					toBlock: rangeEnd,
					latestBlock: observedLatestBlock,
					confirmedToBlock: observedConfirmedToBlock,
				}
			} catch (err) {
				lastError = err as Error
				observedLatestBlock = await provider
					.getBlockNumber()
					.catch(() => observedLatestBlock)
				observedConfirmedToBlock = Math.max(
					0,
					observedLatestBlock - Math.max(0, this.config.minConfirmations - 1),
				)
				if (fromBlock > observedConfirmedToBlock) {
					return {
						ok: false,
						wait: true,
						error: err as Error,
						latestBlock: observedLatestBlock,
						confirmedToBlock: observedConfirmedToBlock,
					}
				}
				if (attempt === 3) {
					break
				}

				const maxRangeEnd = Math.min(rangeEnd - 1, observedConfirmedToBlock)
				if (maxRangeEnd < fromBlock) {
					return {
						ok: false,
						wait: true,
						error: err as Error,
						latestBlock: observedLatestBlock,
						confirmedToBlock: observedConfirmedToBlock,
					}
				}

				const currentSpan = Math.max(1, rangeEnd - fromBlock)
				const reducedSpan = Math.floor(currentSpan / 2)
				rangeEnd = Math.min(maxRangeEnd, fromBlock + reducedSpan)
			}
		}

		return {
			ok: false,
			wait: false,
			error: lastError || new Error('manual_payment_log_scan_failed'),
			latestBlock: observedLatestBlock,
			confirmedToBlock: observedConfirmedToBlock,
		}
	}

	async processSweepQueue() {
		return this.sweeper.processSweepQueue()
	}

	async processSweepQueueInternal() {
		if (!this.isConfigured() || !this.canAutoSweep()) return
		const pending = this.store.find('payments', (payment) => {
			const candidate = payment as PaymentLike
			return (
				candidate.method === 'manual' &&
				candidate.status === 'confirmed' &&
				Boolean(candidate.txHash) &&
				candidate.sweep?.status !== 'confirmed'
			)
		}) as PaymentLike[]
		for (const payment of pending) {
			try {
				await this.sweepPayment(payment)
			} catch (err) {
				const checkout = this.store.getById(
					'checkouts',
					String(payment.checkoutId || ''),
				) as CheckoutLike | null
				this.store.update('payments', String(payment.id || ''), {
					sweep: {
						...(payment.sweep || {}),
						status: 'failed',
						error: err.message,
						updatedAt: nowIso(),
					},
				})
				if (checkout?.manualPayment) {
					this.store.update('checkouts', checkout.id, {
						manualPayment: {
							...(checkout.manualPayment || {}),
							sweepStatus: 'failed',
							lastSweepError: err.message,
							updatedAt: nowIso(),
						},
					})
				}
			}
		}
	}

	async sweepPayment(payment: PaymentLike) {
		return this.sweeper.sweepPayment(payment)
	}

	async sweepPaymentInternal(payment: PaymentLike) {
		const checkout = this.store.getById(
			'checkouts',
			String(payment.checkoutId || ''),
		) as CheckoutLike | null
		if (!checkout?.manualPayment?.available) return
		const chain = String(payment.chain || '')
		const asset = String(payment.asset || '')
		const treasuryAddress = checkout.recipientByChain?.[chain]
		const derivationIndex = checkout.manualPayment.derivationIndex
		if (!treasuryAddress || !Number.isInteger(derivationIndex)) return

		await this.ready
		const provider = await this.provider(chain)
		const assetConfig = this.config.assets[asset]
		if (!assetConfig || assetConfig.type !== 'erc20') {
			this.store.update('payments', payment.id, {
				sweep: {
					...(payment.sweep || {}),
					status: 'unsupported',
					error: 'manual sweep only supports ERC-20 assets',
					updatedAt: nowIso(),
				},
			})
			return
		}

		const tokenAddress = normalizeAddress(assetConfig.addresses?.[chain])
		const childWallet = await this.deriveWallet(derivationIndex)
		const fromAddress = childWallet.address
		const tokenBalance = BigInt(
			await provider.readErc20Balance({
				tokenAddress,
				owner: fromAddress,
			}),
		)
		if (tokenBalance <= 0n) {
			this.store.update('payments', payment.id, {
				sweep: {
					...(payment.sweep || {}),
					status: 'confirmed',
					sweptAt: nowIso(),
					amountBaseUnits: '0',
					updatedAt: nowIso(),
				},
			})
			return
		}

		const feeData = await provider.getFeeData().catch(() => null)
		const feeOverrides = feeData ? this.feeOverrides(feeData) : null
		const txData = await encodeErc20TransferData({
			to: treasuryAddress,
			amount: tokenBalance,
		})
		const gasLimit = BigInt(
			await provider.estimateErc20TransferGas({
				tokenAddress,
				account: fromAddress,
				to: treasuryAddress,
				amount: tokenBalance,
			}),
		)

		if (this.sweepMode === 'external_signer') {
			const sweepResult = await this.requestExternalSweep({
				payment,
				checkout,
				chain,
				derivationIndex,
				fromAddress,
				treasuryAddress,
				tokenAddress,
				tokenBalance,
				gasLimit,
				feeOverrides,
			})
			this.store.update('payments', payment.id, {
				sweep: {
					status: 'confirmed',
					mode: 'external_signer',
					fundingTxHash: sweepResult.fundingTxHash || '',
					txHash: sweepResult.txHash,
					amountBaseUnits: tokenBalance.toString(),
					treasuryAddress,
					sweptAt: nowIso(),
					updatedAt: nowIso(),
				},
			})

			this.store.update('checkouts', checkout.id, {
				manualPayment: {
					...(checkout.manualPayment || {}),
					sweepStatus: 'confirmed',
					sweptAt: nowIso(),
					sweepTxHash: sweepResult.txHash,
					fundingTxHash: sweepResult.fundingTxHash || '',
				},
			})
			return
		}

		if (this.sweepMode !== 'local') {
			this.store.update('payments', payment.id, {
				sweep: {
					...(payment.sweep || {}),
					status: 'manual_required',
					mode: 'manual',
					amountBaseUnits: tokenBalance.toString(),
					treasuryAddress,
					updatedAt: nowIso(),
				},
			})
			this.store.update('checkouts', checkout.id, {
				manualPayment: {
					...(checkout.manualPayment || {}),
					sweepStatus: 'manual_required',
					updatedAt: nowIso(),
				},
			})
			return
		}

		const rpcUrl = this.providers.get(chain)?.rpcUrl || ''
		const sponsorWallet = (await createViemWalletClient({
			chain,
			chainConfig: this.config.chains[chain],
			rpcUrl,
			privateKey: this.sponsorPrivateKey,
		})) as WalletClientLike
		const requiredNative = (gasLimit * feeOverrides.unitPrice * 12n) / 10n
		const currentNative = await provider.getBalance(fromAddress)
		let fundingTxHash = payment.sweep?.fundingTxHash || null

		if (currentNative < requiredNative) {
			const topUpAmount = requiredNative - currentNative
			fundingTxHash = await sponsorWallet.sendTransaction({
				to: fromAddress,
				value: topUpAmount,
				...feeOverrides.tx,
			})
			await provider.waitForTransactionReceipt({
				hash: fundingTxHash,
				confirmations: this.config.minConfirmations,
			})
		}

		const signerWallet = (await createViemWalletClient({
			chain,
			chainConfig: this.config.chains[chain],
			rpcUrl,
			privateKey: childWallet.privateKey,
		})) as WalletClientLike
		const sweepTxHash = await signerWallet.sendTransaction({
			to: tokenAddress,
			data: txData,
			gas: gasLimit,
			...feeOverrides.tx,
		})
		await provider.waitForTransactionReceipt({
			hash: sweepTxHash,
			confirmations: this.config.minConfirmations,
		})

		this.store.update('payments', payment.id, {
			sweep: {
				status: 'confirmed',
				fundingTxHash,
				txHash: sweepTxHash,
				amountBaseUnits: tokenBalance.toString(),
				treasuryAddress,
				sweptAt: nowIso(),
				updatedAt: nowIso(),
			},
		})

		this.store.update('checkouts', checkout.id, {
			manualPayment: {
				...(checkout.manualPayment || {}),
				sweepStatus: 'confirmed',
				sweptAt: nowIso(),
				sweepTxHash: sweepTxHash,
				fundingTxHash: fundingTxHash || '',
			},
		})
	}

	feeOverrides(feeData: FeeDataLike): SweepFeeOverrides {
		return this.sweeper.feeOverrides(feeData)
	}

	feeOverridesInternal(feeData: FeeDataLike): SweepFeeOverrides {
		if (
			feeData?.maxFeePerGas != null &&
			feeData?.maxPriorityFeePerGas != null
		) {
			return {
				unitPrice: BigInt(feeData.maxFeePerGas),
				tx: {
					maxFeePerGas: feeData.maxFeePerGas,
					maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
				},
			}
		}
		if (feeData?.gasPrice != null) {
			return {
				unitPrice: BigInt(feeData.gasPrice),
				tx: { gasPrice: feeData.gasPrice },
			}
		}
		throw new Error('fee_data_unavailable')
	}

	async runCycle() {
		return this.scanner.runCycle()
	}

	async runCycleInternal() {
		if (this.running) return
		this.running = true
		try {
			const pendingCheckouts = (
				this.store.find('checkouts', (checkout) => {
					const candidate = checkout as CheckoutLike
					return (
						candidate.status !== 'paid' &&
						Boolean(candidate.manualPayment?.available)
					)
				}) as CheckoutLike[]
			).sort((a, b) =>
				String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
			)
			const seenAddresses = new Set()
			for (const checkout of pendingCheckouts) {
				const manualAddress = String(
					checkout.manualPayment?.address || '',
				).toLowerCase()
				if (manualAddress) {
					if (seenAddresses.has(manualAddress)) {
						this.store.update('checkouts', checkout.id, {
							manualPayment: {
								...(checkout.manualPayment || {}),
								available: false,
								status: 'disabled',
								reason: 'duplicate_manual_address_detected',
								updatedAt: nowIso(),
							},
						})
						continue
					}
					seenAddresses.add(manualAddress)
				}
				try {
					await this.reconcileCheckout(checkout)
				} catch (err) {
					this.store.update('checkouts', checkout.id, {
						manualPayment: {
							...(checkout.manualPayment || {}),
							lastScanError: err.message,
							lastScanAt: nowIso(),
						},
					})
				}
			}
			if (this.canAutoSweep()) {
				try {
					await this.processSweepQueue()
				} catch (err) {
					console.error('manual_payment_sweep_error', err)
				}
			}
		} finally {
			this.running = false
		}
	}

	start() {
		if (this.timer || !this.isConfigured()) return
		this.timer = setInterval(() => {
			this.runCycle().catch((err) =>
				console.error('manual_payment_cycle_error', err),
			)
		}, this.scanIntervalMs)
		this.runCycle().catch((err) =>
			console.error('manual_payment_cycle_error', err),
		)
	}

	stop() {
		if (!this.timer) return
		clearInterval(this.timer)
		this.timer = null
	}
}

ManualPaymentService.prototype.requestExternalSweep =
	async function requestExternalSweep({
		payment,
		checkout,
		chain,
		derivationIndex,
		fromAddress,
		treasuryAddress,
		tokenAddress,
		tokenBalance,
		gasLimit,
		feeOverrides,
	}: ExternalSweepRequestInput) {
		const body = JSON.stringify({
			action: 'sweep_erc20',
			chain,
			derivationPath: this.derivationPath,
			derivationIndex,
			fromAddress,
			toAddress: treasuryAddress,
			tokenAddress,
			amountBaseUnits: tokenBalance.toString(),
			gasLimit: gasLimit.toString(),
			checkoutId: checkout.id,
			paymentId: payment.id,
			minConfirmations: this.config.minConfirmations,
			fee: feeOverrides?.tx
				? Object.fromEntries(
						Object.entries(feeOverrides.tx).map(([key, value]) => [
							key,
							value.toString(),
						]),
					)
				: {},
		})
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			'content-length': String(Buffer.byteLength(body)),
		}
		if (this.sweepSignerSecret)
			headers.authorization = `Bearer ${this.sweepSignerSecret}`
		const response = (await requestJson(this.sweepSignerUrl, {
			body,
			headers,
			timeoutMs: this.config.webhookTimeoutMs,
		})) as { statusCode: number; body?: AnyRecord }
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`external_sweeper_http_${response.statusCode}`)
		}
		const payload = response.body || {}
		const txHash = String(payload.txHash || payload.sweepTxHash || '').trim()
		if (!txHash) throw new Error('external_sweeper_missing_tx_hash')
		return {
			txHash,
			fundingTxHash: String(payload.fundingTxHash || '').trim(),
		}
	}

export { ManualPaymentService }
