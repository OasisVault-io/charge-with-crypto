import { createContext, useContext } from 'react'

import {
  type CheckoutBalance,
  type CheckoutConfig,
  type CheckoutManualRoute,
  type CheckoutPayment,
  type CheckoutQuote,
  type CheckoutRail,
  type CheckoutRecord,
  type WalletProviderOption,
  type WalletSession,
} from '../checkout.types'

type CheckoutPageContextValue = {
  amountText: string
  availableWalletProviders: WalletProviderOption[]
  checkout: CheckoutRecord | null | undefined
  config: CheckoutConfig | null | undefined
  expired: boolean
  hasManualPayment: boolean
  isBusy: boolean
  logoSrc: string
  manualPanelOpen: boolean
  merchantName: string
  paymentRail: CheckoutRail
  payments: CheckoutPayment[]
  pendingPayment: CheckoutPayment | null
  recommendedQuote: CheckoutQuote | null
  routeBalance: CheckoutBalance | null
  routePayable: boolean
  selectedManualRoute: CheckoutManualRoute | null
  statusMessage: string
  walletCompatibleQuotes: CheckoutQuote[]
  walletConnected: boolean
  walletMetaCopy: string
  walletSession: WalletSession | null
  closeManualPanel: () => void
  connectWallet: (providerId?: WalletProviderOption['id']) => Promise<void>
  copyManualAddress: () => Promise<void>
  disconnectWallet: () => void
  openManualPanel: () => Promise<void>
  payWithWallet: () => Promise<void>
  refreshQuote: () => Promise<void>
  setLogoSrc: (value: string) => void
  description: string
  heroParts: {
    lead: string
    trail: string
  }
}

const CheckoutPageContext = createContext<CheckoutPageContextValue | null>(null)

export const CheckoutPageProvider = CheckoutPageContext.Provider

export const useCheckoutPageContext = () => {
  const value = useContext(CheckoutPageContext)
  if (!value) {
    throw new Error(
      'useCheckoutPageContext must be used within CheckoutPageProvider',
    )
  }
  return value
}
