import { createContext, useContext } from 'react'

import {
  type PaymentFilterState,
  type DashboardSection,
} from '../dashboard.shared'
import {
  type DashboardChecklistItem,
  type DashboardCheckoutDraft,
  type DashboardConfig,
  type DashboardCreatedCheckout,
  type DashboardData,
  type DashboardMerchant,
  type DashboardMerchantDraft,
  type MerchantPayment,
} from '../dashboard.types'

type DashboardPageContextValue = {
  activeSection: DashboardSection
  appConfig: DashboardConfig
  checklist: DashboardChecklistItem[]
  checkoutDraft: DashboardCheckoutDraft
  completedSetup: number
  createdCheckout: DashboardCreatedCheckout | null
  dashboardData: DashboardData
  editingEnabled: boolean
  expandedPlanIndex: number | null
  filteredPayments: MerchantPayment[]
  filteredVolume: number
  merchant: DashboardMerchant
  merchantDraft: DashboardMerchantDraft
  merchantStatus: string
  openCheckouts: number
  operationsConfigured: number
  paymentFilter: PaymentFilterState
  payments: MerchantPayment[]
  totalConfirmedVolume: number
  addPlan: () => void
  applySelectedPlan: (planId: string) => void
  createCheckout: (resolved: boolean) => Promise<void>
  exportPayments: () => void
  patchPaymentFilter: (patch: Partial<PaymentFilterState>) => void
  removePlan: (index: number) => void
  saveMerchant: () => Promise<void>
  setActiveSection: (section: DashboardSection) => void
  setCheckoutField: <K extends keyof DashboardCheckoutDraft>(
    field: K,
    value: DashboardCheckoutDraft[K],
  ) => void
  setExpandedPlanIndex: (value: number | null) => void
  setMerchantDefaultRail: (nextRail: string) => void
  setMerchantField: <K extends keyof DashboardMerchantDraft>(
    field: K,
    value: DashboardMerchantDraft[K],
  ) => void
  setMerchantRecipientAddress: (chain: string, value: string) => void
  setPlanRail: (index: number, nextRail: string) => void
  syncCheckoutRail: (nextRail: string) => void
  updatePlan: (
    index: number,
    patch: Partial<DashboardMerchantDraft['plans'][number]>,
  ) => void
  uploadLogo: (file: File | null) => Promise<void>
  duplicatePlan: (index: number) => void
}

const DashboardPageContext = createContext<DashboardPageContextValue | null>(
  null,
)

export const DashboardPageProvider = DashboardPageContext.Provider

export const useDashboardPageContext = () => {
  const value = useContext(DashboardPageContext)
  if (!value) {
    throw new Error(
      'useDashboardPageContext must be used within DashboardPageProvider',
    )
  }
  return value
}
