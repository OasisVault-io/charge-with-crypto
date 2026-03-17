import { type config } from '../../../config'
import {
  bitcoinScriptTypeForXpub,
  deriveBitcoinAddress,
  requireBitcoinXpub,
} from '../../../utils/bitcoin'

type AppConfig = typeof config

type BitcoinAddressServiceDependencies = {
  store: BitcoinAddressStore
  config: AppConfig
}

type BitcoinMerchant = {
  id: string
  bitcoinXpub?: string | null
}

type CounterRecord = {
  id: string
  value?: number | string | null
}

type SettlementAddressAllocation = {
  address: string
  addressSource: 'xpub'
  derivationIndex: number
  derivationPath: string
  scriptType: string
}

interface BitcoinAddressStore {
  getById(collection: string, id: string): CounterRecord | null
  update(
    collection: string,
    id: string,
    patch: Record<string, unknown>,
  ): CounterRecord | null
  insert(collection: string, item: Record<string, unknown>): CounterRecord
}

class BitcoinAddressService {
  config: AppConfig
  store: BitcoinAddressStore
  counterLock: Promise<void>

  constructor({ store, config }: BitcoinAddressServiceDependencies) {
    this.store = store
    this.config = config
    this.counterLock = Promise.resolve()
  }

  isConfiguredForMerchant(
    merchant: BitcoinMerchant | null | undefined,
  ): boolean {
    return Boolean(String(merchant?.bitcoinXpub || '').trim())
  }

  async reserveDerivationIndex(merchantId: string): Promise<number> {
    const counterId = `bitcoin_settlement_index:${merchantId}`
    const pending = this.counterLock
    let release: (() => void) | null = null

    this.counterLock = new Promise<void>((resolve) => {
      release = resolve
    })

    await pending

    try {
      const existing = this.store.getById('counters', counterId)
      if (existing) {
        const index = Number(existing.value || 0)
        this.store.update('counters', existing.id, { value: index + 1 })
        return index
      }

      this.store.insert('counters', { id: counterId, value: 1 })
      return 0
    } finally {
      release?.()
    }
  }

  async allocateSettlementAddress(
    merchant: BitcoinMerchant,
  ): Promise<SettlementAddressAllocation | null> {
    if (!this.isConfiguredForMerchant(merchant)) return null

    const xpub = requireBitcoinXpub(
      merchant.bitcoinXpub,
      'bitcoinXpub',
      this.config.chains.bitcoin,
    )
    const derivationIndex = await this.reserveDerivationIndex(merchant.id)
    const address = deriveBitcoinAddress({
      xpub,
      index: derivationIndex,
      chainConfig: this.config.chains.bitcoin,
    })

    if (!address) throw new Error('failed to derive bitcoin settlement address')

    return {
      address,
      addressSource: 'xpub',
      derivationIndex,
      derivationPath: `0/${derivationIndex}`,
      scriptType: bitcoinScriptTypeForXpub(xpub),
    }
  }
}

export { BitcoinAddressService }
