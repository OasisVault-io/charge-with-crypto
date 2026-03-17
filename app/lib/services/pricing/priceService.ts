import {
  baseUnitsToDecimalString,
  usdToAssetBaseUnits,
} from '../../utils/amounts'
import { type AppConfig, type FetchLike } from '../shared/types'
import { isFixedPegAsset } from './priceSupport'

type AssetPrice = {
  asset: string
  chain: string
  priceUsd: number
  priceMicros: number
  source: string
  fetchedAt: string
}

type CachedPrice = {
  value: AssetPrice
  expiresAt: number
}

type PriceServiceDependencies = {
  config: AppConfig
  fetchImpl?: FetchLike
  now?: () => number
}

const STATIC_FALLBACK_PRICES = {
  BTC: 60000,
  USDC: 1,
  USDT: 1,
  ETH: 2000,
}

const COINGECKO_PLATFORM = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum-one',
  polygon: 'polygon-pos',
}

class PriceService {
  config: AppConfig
  fetchImpl: FetchLike
  now: () => number
  cache: Map<string, CachedPrice>
  cacheTtlMs: number

  constructor({
    config,
    fetchImpl = fetch,
    now = () => Date.now(),
  }: PriceServiceDependencies) {
    this.config = config
    this.fetchImpl = fetchImpl
    this.now = now
    this.cache = new Map()
    this.cacheTtlMs = 30_000
  }

  async getAssetPrice({
    asset,
    chain,
  }: {
    asset: string
    chain: string
  }): Promise<AssetPrice> {
    const cacheKey = `${chain}:${asset}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return cached.value

    const assetConfig = this.config.assets[asset]
    if (!assetConfig) throw new Error('unsupported asset')

    if (isFixedPegAsset(asset)) {
      const fixed = {
        asset,
        chain,
        priceUsd: 1,
        priceMicros: 1_000_000,
        source: 'fixed_peg',
        fetchedAt: new Date(this.now()).toISOString(),
      }
      this.cache.set(cacheKey, {
        value: fixed,
        expiresAt: this.now() + this.cacheTtlMs,
      })
      return fixed
    }

    let priceUsd = null
    let source = 'coingecko'
    try {
      if (asset === 'ETH') {
        priceUsd = await this.fetchCoinGeckoSimple('ethereum')
      } else if (asset === 'BTC') {
        priceUsd = await this.fetchCoinGeckoSimple('bitcoin')
      } else {
        const platform = COINGECKO_PLATFORM[chain]
        const address = assetConfig.addresses?.[chain]
        if (!platform || !address)
          throw new Error('asset not available on chain')
        priceUsd = await this.fetchCoinGeckoToken(platform, address)
      }
    } catch (err) {
      const fallbackPrice = STATIC_FALLBACK_PRICES[asset]
      if (typeof fallbackPrice !== 'number') throw err
      priceUsd = fallbackPrice
      source = 'fallback_static'
    }

    const price = {
      asset,
      chain,
      priceUsd,
      priceMicros: Math.round(priceUsd * 1_000_000),
      source,
      fetchedAt: new Date(this.now()).toISOString(),
    }

    this.cache.set(cacheKey, {
      value: price,
      expiresAt: this.now() + this.cacheTtlMs,
    })
    return price
  }

  async quoteUsd({
    asset,
    chain,
    usdCents,
    decimals,
  }: {
    asset: string
    chain: string
    usdCents: number
    decimals: number
  }) {
    const price = await this.getAssetPrice({ asset, chain })
    const baseUnits = usdToAssetBaseUnits({
      usdCents,
      priceMicros: price.priceMicros,
      decimals,
    })
    return {
      ...price,
      usdCents,
      baseUnits,
      decimalAmount: baseUnitsToDecimalString(
        baseUnits,
        decimals,
        Math.min(decimals, asset === 'ETH' ? 8 : 6),
      ),
    }
  }

  async fetchCoinGeckoSimple(id: string): Promise<number> {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`
    const payload = await this.fetchJson(url)
    const price = payload?.[id]?.usd
    if (typeof price !== 'number' || price <= 0)
      throw new Error('price_unavailable')
    return price
  }

  async fetchCoinGeckoToken(
    platform: string,
    address: string,
  ): Promise<number> {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${encodeURIComponent(address)}&vs_currencies=usd`
    const payload = await this.fetchJson(url)
    const price = payload?.[String(address).toLowerCase()]?.usd
    if (typeof price !== 'number' || price <= 0)
      throw new Error('price_unavailable')
    return price
  }

  async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`price_http_${response.status}`)
    return response.json()
  }
}

export { PriceService }
