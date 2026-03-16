import {
	type CheckoutBalance,
	type CheckoutConfig,
	type CheckoutPayment,
	type CheckoutQuote,
	type CheckoutRecord,
} from './checkout.types'

export const preferredChainOrder = [
	'bitcoin',
	'base',
	'arbitrum',
	'polygon',
	'ethereum',
]
export const preferredAssetOrder = ['BTC', 'USDC', 'USDT', 'ETH']
export const defaultMerchantLogo = '/charge-with-crypto-mark.svg'

const dueAmountFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
})

export function quoteKey(quote: CheckoutQuote) {
	return `${quote.chain}:${quote.asset}`
}

export function quoteExpiresAtMs(quote: CheckoutQuote | null | undefined) {
	if (!quote?.expiresAt) return null
	const value = new Date(quote.expiresAt).getTime()
	return Number.isFinite(value) ? value : null
}

export function quoteExpiredLocally(
	quote: CheckoutQuote | null | undefined,
	now = Date.now(),
) {
	const expiresAt = quoteExpiresAtMs(quote)
	return expiresAt != null && expiresAt <= now
}

export function activeQuotes(quotes: CheckoutQuote[] = [], now = Date.now()) {
	return (quotes || []).filter((quote) => !quoteExpiredLocally(quote, now))
}

export function pendingOnchainPayment(payments: CheckoutPayment[] = []) {
	return (
		(payments || []).find(
			(payment) =>
				payment.method === 'onchain' &&
				payment.status !== 'confirmed' &&
				payment.txHash,
		) || null
	)
}

export function paymentWindowExpired(
	{
		checkout,
		quotes,
		payments,
	}: {
		checkout: CheckoutRecord | null | undefined
		quotes: CheckoutQuote[]
		payments: CheckoutPayment[]
	},
	now = Date.now(),
) {
	if (checkout?.status === 'paid' || pendingOnchainPayment(payments))
		return false
	const expiringQuotes = (quotes || []).filter(
		(quote) => quoteExpiresAtMs(quote) != null,
	)
	if (!expiringQuotes.length) return false
	return expiringQuotes.every((quote) => quoteExpiredLocally(quote, now))
}

export function paymentWindowRemainingMs(
	quotes: CheckoutQuote[] = [],
	now = Date.now(),
) {
	const expiries = activeQuotes(quotes, now)
		.map((quote) => quoteExpiresAtMs(quote))
		.filter((value) => value != null)
	if (!expiries.length) return null
	return Math.max(0, Math.min(...(expiries as number[])) - now)
}

export function formatCountdown(ms: number) {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function chainHex(chainId: number) {
	return `0x${Number(chainId).toString(16)}`
}

export function explorerTx(chain: string, txHash: string) {
	const base = {
		bitcoin: 'https://mempool.space/tx/',
		ethereum: 'https://etherscan.io/tx/',
		base: 'https://basescan.org/tx/',
		arbitrum: 'https://arbiscan.io/tx/',
		polygon: 'https://polygonscan.com/tx/',
	}[chain]
	return base ? `${base}${txHash}` : txHash
}

export function chainLabel(
	config: CheckoutConfig | null | undefined,
	chain: string,
) {
	return config?.chains?.[chain]?.name || chain
}

export function shortAddress(address: string) {
	if (!address) return ''
	if (address.length <= 18) return address
	return `${address.slice(0, 8)}...${address.slice(-6)}`
}

export function formatUsdAmount(amount: number | string) {
	return dueAmountFormatter.format(Number(amount || 0))
}

export function dueAmountClassName(amountText: string) {
	const digitCount = String(amountText || '').replace(/\D/g, '').length
	if (digitCount >= 10) return 'hero-amount hero-amount-ultra'
	if (digitCount >= 8) return 'hero-amount hero-amount-compact'
	if (digitCount >= 6) return 'hero-amount hero-amount-tight'
	return 'hero-amount'
}

export function safeLogoSrc(src: string) {
	return src || defaultMerchantLogo
}

export function merchantDisplayName(
	checkout: CheckoutRecord | null | undefined,
) {
	const raw =
		checkout?.merchantBrandName ||
		checkout?.merchantName ||
		checkout?.merchantId ||
		'merchant'
	if (/^merchant_default$/i.test(String(raw))) return 'OasisVault'
	return (
		String(raw)
			.replace(/^merchant[_-]?/i, '')
			.replace(/[_-]+/g, ' ')
			.trim() || 'merchant'
	)
}

export function merchantHeroParts(checkout: CheckoutRecord | null | undefined) {
	const merchantName = merchantDisplayName(checkout)
		.replace(/\s+checkout$/i, '')
		.trim()
	if (
		/^oasis\s*vault$/i.test(merchantName) ||
		/^oasisvault$/i.test(merchantName)
	) {
		return { lead: 'WITH', trail: 'OASIS VAULT' }
	}
	const camelSplit = merchantName.replace(/([a-z])([A-Z])/g, '$1 $2')
	const words = camelSplit.split(/\s+/).filter(Boolean)
	if (!words.length) return { lead: 'WITH MERCHANT', trail: 'PAYMENT' }
	if (words.length === 1)
		return { lead: `WITH ${words[0].toUpperCase()}`, trail: 'PAYMENT' }
	return {
		lead: `WITH ${words[0].toUpperCase()}`,
		trail: words.slice(1).join(' ').toUpperCase(),
	}
}

export function checkoutTemplate(
	checkout: CheckoutRecord | null | undefined,
	templateParam = '',
) {
	const candidate = (
		templateParam ||
		checkout?.checkoutTemplate ||
		''
	).toLowerCase()
	return candidate === 'oasis' ? 'oasis' : 'neutral'
}

export function balanceForQuote(
	balances: Record<string, CheckoutBalance> | undefined,
	quote: CheckoutQuote,
) {
	return balances?.[quoteKey(quote)] || null
}

export function isQuotePayable(
	balances: Record<string, CheckoutBalance> | undefined,
	quote: CheckoutQuote,
) {
	const balance = balanceForQuote(balances, quote)
	return Boolean(
		balance &&
		balance.raw != null &&
		BigInt(balance.raw) >= BigInt(quote.cryptoAmountBaseUnits),
	)
}

export function routeScore(quote: CheckoutQuote) {
	const assetIndex = preferredAssetOrder.indexOf(quote.asset)
	const chainIndex = preferredChainOrder.indexOf(quote.chain)
	return (
		(assetIndex === -1 ? 99 : assetIndex) * 10 +
		(chainIndex === -1 ? 99 : chainIndex)
	)
}

export function manualPaymentAvailable(
	checkout: CheckoutRecord | null | undefined,
) {
	return Boolean(checkout?.manualPayment?.available)
}

export function refreshNeeded(
	config: CheckoutConfig | null | undefined,
	checkout: CheckoutRecord | null | undefined,
) {
	const fixedAssets = new Set(config?.fixedPriceAssets || [])
	const assets = checkout?.acceptedAssets || []
	return assets.some((asset: string) => !fixedAssets.has(asset))
}
