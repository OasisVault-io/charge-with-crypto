import {
  type BitcoinAddressSummary,
  type BitcoinTransaction,
  type FetchLike,
} from '../../shared/types'

type BitcoinClientDependencies = {
  baseUrl: string
  fetchImpl?: FetchLike
}

class BitcoinClient {
  baseUrl: string
  fetchImpl: FetchLike

  constructor({ baseUrl, fetchImpl = fetch }: BitcoinClientDependencies) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
  }

  async getAddress(address: string): Promise<BitcoinAddressSummary> {
    return this.fetchJson(
      `/address/${encodeURIComponent(address)}`,
    ) as Promise<BitcoinAddressSummary>
  }

  async getAddressTxs(address: string): Promise<BitcoinTransaction[]> {
    return this.fetchJson(
      `/address/${encodeURIComponent(address)}/txs`,
    ) as Promise<BitcoinTransaction[]>
  }

  async getTransaction(txid: string): Promise<BitcoinTransaction | null> {
    return this.fetchJson(
      `/tx/${encodeURIComponent(txid)}`,
    ) as Promise<BitcoinTransaction | null>
  }

  async getTipHeight() {
    const response = await this.fetchImpl(`${this.baseUrl}/blocks/tip/height`, {
      headers: { accept: 'text/plain' },
    })
    if (!response.ok) throw new Error(`bitcoin_http_${response.status}`)
    const value = Number(await response.text())
    if (!Number.isInteger(value) || value < 0)
      throw new Error('bitcoin_tip_height_unavailable')
    return value
  }

  async fetchJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`bitcoin_http_${response.status}`)
    return response.json()
  }
}

export { BitcoinClient }
