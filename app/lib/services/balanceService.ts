import { type config } from '../config'
import { BitcoinBalanceService } from './chains/bitcoin/bitcoinBalanceService'
import { EvmBalanceService } from './chains/evm/evmBalanceService'

type AppConfig = typeof config

type BalanceServiceDependencies = {
	config: AppConfig
	fetchImpl?: typeof fetch
}

type RouteBalance = {
	raw: string | null
	display: string
	error?: string
	confirmedRaw?: string
	unconfirmedRaw?: string
}

type BalanceLookupKey = `${string}:${string}`

type QuoteRoute = {
	chain: string
	asset: string
}

type ReadRouteBalanceInput = {
	walletAddress: string
	chain: string
	asset: string
}

type ScanQuotesInput = {
	walletAddress: string
	quotes?: QuoteRoute[]
	walletRail?: '' | 'bitcoin' | 'evm'
}

interface EvmBalanceReader {
	readRouteBalance(input: ReadRouteBalanceInput): Promise<RouteBalance>
}

interface BitcoinBalanceReader {
	readRouteBalance(input: ReadRouteBalanceInput): Promise<RouteBalance>
}

class BalanceService {
	config: AppConfig
	evm: EvmBalanceReader
	bitcoin: BitcoinBalanceReader

	constructor({ config, fetchImpl = fetch }: BalanceServiceDependencies) {
		this.config = config
		this.evm = new EvmBalanceService({ config, fetchImpl })
		this.bitcoin = new BitcoinBalanceService({ config, fetchImpl })
	}

	async readRouteBalance({
		walletAddress,
		chain,
		asset,
	}: ReadRouteBalanceInput): Promise<RouteBalance> {
		if (chain === 'bitcoin')
			return this.bitcoin.readRouteBalance({ walletAddress, chain, asset })
		return this.evm.readRouteBalance({ walletAddress, chain, asset })
	}

	async scanQuotes({
		walletAddress,
		quotes = [],
		walletRail = '',
	}: ScanQuotesInput): Promise<Record<BalanceLookupKey, RouteBalance>> {
		const scopedQuotes = (quotes || []).filter((quote) => {
			if (walletRail === 'bitcoin') return quote.chain === 'bitcoin'
			if (walletRail === 'evm') return quote.chain !== 'bitcoin'
			return true
		})
		const balances: Partial<Record<BalanceLookupKey, RouteBalance>> = {}
		await Promise.all(
			scopedQuotes.map(async (quote: QuoteRoute) => {
				const key = `${quote.chain}:${quote.asset}` as BalanceLookupKey
				try {
					balances[key] = await this.readRouteBalance({
						walletAddress,
						chain: quote.chain,
						asset: quote.asset,
					})
				} catch (err) {
					const errorMessage =
						err instanceof Error ? err.message : 'Unknown error'
					balances[key] = {
						raw: null,
						display: 'Unavailable',
						error: errorMessage,
					}
				}
			}),
		)
		return balances as Record<BalanceLookupKey, RouteBalance>
	}
}

export { BalanceService }
