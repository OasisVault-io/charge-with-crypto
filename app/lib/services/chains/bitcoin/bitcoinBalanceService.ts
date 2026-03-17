import { baseUnitsToDecimalString } from '../../../utils/amounts'
import {
  type AppConfig,
  type BitcoinAddressSummary,
  type FetchLike,
  type RouteBalance,
} from '../../shared/types'
import { BitcoinClient } from './bitcoinClient'

type BitcoinBalanceDependencies = {
  config: AppConfig
  fetchImpl?: FetchLike
}

type ReadRouteBalanceInput = {
  walletAddress: string
  asset: string
}

class BitcoinBalanceService {
  config: AppConfig
  client: {
    getAddress(address: string): Promise<BitcoinAddressSummary>
  }

  constructor({ config, fetchImpl = fetch }: BitcoinBalanceDependencies) {
    this.config = config
    this.client = new BitcoinClient({
      baseUrl: config.bitcoinEsploraBaseUrl,
      fetchImpl,
    })
  }

  async readRouteBalance({
    walletAddress,
    asset,
  }: ReadRouteBalanceInput): Promise<RouteBalance> {
    if (asset !== 'BTC') throw new Error('asset not available on bitcoin')
    const summary = await this.client.getAddress(walletAddress)
    const confirmed =
      BigInt(summary?.chain_stats?.funded_txo_sum || 0) -
      BigInt(summary?.chain_stats?.spent_txo_sum || 0)
    const mempool =
      BigInt(summary?.mempool_stats?.funded_txo_sum || 0) -
      BigInt(summary?.mempool_stats?.spent_txo_sum || 0)
    const raw = confirmed + mempool
    return {
      raw: raw.toString(),
      display: baseUnitsToDecimalString(
        raw,
        this.config.assets.BTC.decimals,
        8,
      ),
      confirmedRaw: confirmed.toString(),
      unconfirmedRaw: mempool.toString(),
    }
  }
}

export { BitcoinBalanceService }
