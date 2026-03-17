import { type config } from '../../../config'
import { baseUnitsToDecimalString } from '../../../utils/amounts'
import { RpcClient } from './rpcClient'

type AppConfig = typeof config

type BalanceServiceDependencies = {
  config: AppConfig
  fetchImpl?: typeof fetch
}

type ReadRouteBalanceInput = {
  walletAddress: string
  chain: string
  asset: string
}

type RouteBalance = {
  raw: string | null
  display: string
  error?: string
  confirmedRaw?: string
  unconfirmedRaw?: string
}

type EvmChainConfig = {
  rpcUrlEnv?: string
}

type AssetConfig = {
  type?: string
  decimals: number
  addresses?: Record<string, string>
}

function balanceOfCallData(address: string): string {
  return `0x70a08231000000000000000000000000${String(address).toLowerCase().replace(/^0x/, '')}`
}

class EvmBalanceService {
  config: AppConfig
  clients: Map<string, RpcClient>

  constructor({ config, fetchImpl = fetch }: BalanceServiceDependencies) {
    this.config = config
    this.clients = new Map()

    for (const [chain, chainConfig] of Object.entries(config.chains) as Array<
      [string, EvmChainConfig]
    >) {
      if (chain === 'bitcoin') continue
      if (!chainConfig.rpcUrlEnv) continue

      const endpoint = process.env[chainConfig.rpcUrlEnv]
      if (!endpoint) continue

      this.clients.set(chain, new RpcClient(endpoint, { fetchImpl }))
    }
  }

  client(chain: string): RpcClient {
    const client = this.clients.get(chain)
    if (!client) throw new Error(`missing rpc for ${chain}`)
    return client
  }

  async readRouteBalance({
    walletAddress,
    chain,
    asset,
  }: ReadRouteBalanceInput): Promise<RouteBalance> {
    const assetConfig = this.config.assets[asset] as AssetConfig | undefined
    if (!assetConfig) throw new Error(`unsupported asset: ${asset}`)

    const client = this.client(chain)

    if (assetConfig.type === 'native') {
      const raw = BigInt(
        String(await client.call('eth_getBalance', [walletAddress, 'latest'])),
      )
      return {
        raw: raw.toString(),
        display: baseUnitsToDecimalString(raw, assetConfig.decimals, 6),
      }
    }

    const tokenAddress = assetConfig.addresses?.[chain]
    if (!tokenAddress) throw new Error(`asset not available on ${chain}`)

    const raw = BigInt(
      String(
        await client.call('eth_call', [
          { to: tokenAddress, data: balanceOfCallData(walletAddress) },
          'latest',
        ]),
      ),
    )

    return {
      raw: raw.toString(),
      display: baseUnitsToDecimalString(raw, assetConfig.decimals, 6),
    }
  }
}

export { EvmBalanceService }
