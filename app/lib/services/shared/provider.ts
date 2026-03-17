import { type VerificationInput, type VerificationResult } from './types'

class OnchainProvider {
  async verifyPayment(_input: VerificationInput): Promise<VerificationResult> {
    throw new Error('Not implemented')
  }
}

class ProviderRegistry {
  providers: Map<string, OnchainProvider>

  constructor() {
    this.providers = new Map()
  }

  register(name: string, provider: OnchainProvider) {
    this.providers.set(name, provider)
  }

  get(name: string): OnchainProvider {
    const provider = this.providers.get(name)
    if (!provider) throw new Error(`Provider not registered: ${name}`)
    return provider
  }
}

export { OnchainProvider, ProviderRegistry }
