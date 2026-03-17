// @ts-nocheck
declare global {
  type PhantomWalletAdapter = {
    BrowserSDK: typeof import('@phantom/browser-sdk').BrowserSDK
    AddressType: typeof import('@phantom/browser-sdk').AddressType
  }

  interface XverseWalletAdapter {
    request?: (method: string, params?: Record<string, unknown>) => Promise<any>
    setDefaultProvider?: (providerId: string) => void
    DefaultAdaptersInfo?: {
      xverse?: {
        id?: string
      }
    }
    AddressPurpose?: {
      Payment?: string
    }
  }

  interface Window {
    ethereum?: {
      request?: (args: {
        method: string
        params?: unknown[] | Record<string, unknown>
      }) => Promise<unknown>
    }
    ChargeWithCryptoVendors?: {
      xverse?: XverseWalletAdapter
      phantom?: PhantomWalletAdapter
    }
  }
}

export {}
