import { useDeferredValue, useEffect, useMemo } from 'react'

import { DashboardPageProvider } from './context/DashboardPageContext'
import {
  filteredMerchantPayments,
  merchantPayments,
  merchantSettlementConfigured,
  dashboardTokenStorageKey,
  isDashboardSection,
} from './dashboard.shared'
import {
  type DashboardChecklistItem,
  type DashboardConfig,
  type DashboardData,
  type DashboardMerchant,
} from './dashboard.types'
import { DashboardActivitySection } from './DashboardActivitySection'
import { DashboardAuthGate } from './DashboardAuthGate'
import { DashboardBrandSection } from './DashboardBrandSection'
import { DashboardCheckoutSection } from './DashboardCheckoutSection'
import { DashboardOverviewSection } from './DashboardOverviewSection'
import { DashboardPaymentsSection } from './DashboardPaymentsSection'
import { DashboardPlansSection } from './DashboardPlansSection'
import { DashboardSettlementSection } from './DashboardSettlementSection'
import { DashboardSidebar } from './DashboardSidebar'
import { DashboardTopbar } from './DashboardTopbar'
import { DashboardWebhooksSection } from './DashboardWebhooksSection'
import { useDashboardPageActions } from './hooks/useDashboardPageActions'
import { useDashboardPageState } from './hooks/useDashboardPageState'

type DashboardPageProps = {
  merchantId: string
  appConfig: DashboardConfig
  initialData: DashboardData
}

const EMPTY_MERCHANT: DashboardMerchant = {}

export function DashboardPage({
  merchantId,
  appConfig,
  initialData,
}: DashboardPageProps) {
  const {
    state,
    addPlan,
    applySelectedPlan,
    clearDashboardToken,
    dashboardReloaded,
    duplicatePlan,
    hydrate,
    patchPaymentFilter,
    removePlan,
    setActiveSection,
    setAuthInput,
    setAuthStatus,
    setCheckoutField,
    setCheckoutStatus,
    setCreatedCheckout,
    setDashboardToken,
    setExpandedPlanIndex,
    setMerchantDefaultRail,
    setMerchantField,
    setMerchantRecipientAddress,
    setMerchantStatus,
    setPlanRail,
    syncCheckoutRail,
    updatePlan,
  } = useDashboardPageState(initialData, appConfig)

  const {
    activeSection,
    authInput,
    authStatus,
    checkoutDraft,
    checkoutStatus,
    createdCheckout,
    dashboardData,
    dashboardToken,
    expandedPlanIndex,
    merchantDraft,
    merchantStatus,
    paymentFilter,
  } = state

  const deferredSearch = useDeferredValue(paymentFilter.search)

  useEffect(() => {
    hydrate(initialData, appConfig)
  }, [appConfig, hydrate, initialData])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextSection = (window.location.hash || '#overview').slice(1)
    if (nextSection) {
      setActiveSection(
        isDashboardSection(nextSection) ? nextSection : 'overview',
      )
    }
    const onHashChange = () => {
      const section = (window.location.hash || '#overview').slice(1)
      setActiveSection(isDashboardSection(section) ? section : 'overview')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [setActiveSection])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.hash = activeSection
    window.history.replaceState({}, '', url.toString())
  }, [activeSection])

  const payments = useMemo(
    () => merchantPayments(dashboardData),
    [dashboardData],
  )
  const filteredPayments = useMemo(
    () =>
      filteredMerchantPayments(dashboardData, {
        ...paymentFilter,
        search: deferredSearch,
      }),
    [dashboardData, deferredSearch, paymentFilter],
  )

  const {
    createCheckout,
    exportPayments,
    reloadDashboard,
    saveMerchant,
    unlockDashboard,
    uploadLogo,
  } = useDashboardPageActions({
    appConfig,
    checkoutDraft,
    dashboardReloaded,
    dashboardToken,
    filteredPayments,
    merchantDraft,
    merchantId,
    clearDashboardToken,
    setAuthInput,
    setAuthStatus,
    setCheckoutStatus,
    setCreatedCheckout,
    setDashboardToken,
    setMerchantField,
    setMerchantStatus,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(dashboardTokenStorageKey) || ''
    if (!stored) return
    setDashboardToken(stored)
    if (appConfig?.dashboardAuthConfigured && !dashboardData?.authenticated) {
      reloadDashboard(stored).catch((error) => {
        console.error('Failed to reload dashboard with stored token', error)
        setAuthStatus('Could not verify your dashboard session. Try again.')
      })
    }
  }, [
    appConfig?.dashboardAuthConfigured,
    dashboardData?.authenticated,
    reloadDashboard,
    setAuthStatus,
    setDashboardToken,
  ])

  const merchant = dashboardData?.merchant ?? EMPTY_MERCHANT
  const editingEnabled =
    dashboardData?.authenticated || !appConfig?.dashboardAuthConfigured
  const confirmedPayments = filteredPayments.filter(
    (payment) => payment.status === 'confirmed',
  )
  const filteredVolume = confirmedPayments.reduce(
    (sum, payment) => sum + Number(payment.checkout?.amountUsd || 0),
    0,
  )
  const totalConfirmedVolume = payments
    .filter((payment) => payment.status === 'confirmed')
    .reduce((sum, payment) => sum + Number(payment.checkout?.amountUsd || 0), 0)
  const openCheckouts = (dashboardData?.checkouts || []).filter(
    (checkout) => checkout.status !== 'paid',
  ).length

  const checklist = useMemo<DashboardChecklistItem[]>(() => {
    const plans = merchant.plans || []
    const enabledChains = merchant.enabledChains || []
    const configuredRecipients = enabledChains.filter((chain) =>
      merchantSettlementConfigured(merchant, chain),
    ).length
    const confirmedCount = payments.filter(
      (payment) => payment.status === 'confirmed',
    ).length
    return [
      {
        label: 'Brand ready',
        detail:
          merchant.brandName && merchant.checkoutHeadline
            ? 'Brand name and checkout copy are set.'
            : 'Add display name and checkout messaging.',
        ready: Boolean(merchant.brandName && merchant.checkoutHeadline),
        section: 'brand',
      },
      {
        label: 'Operations ready',
        detail:
          merchant.webhookUrl &&
          enabledChains.length &&
          configuredRecipients === enabledChains.length
            ? 'Webhook and settlement addresses are configured.'
            : 'Finish webhook setup and add a receiving address for each enabled chain.',
        ready: Boolean(
          merchant.webhookUrl &&
          enabledChains.length &&
          configuredRecipients === enabledChains.length,
        ),
        section: 'settlement',
      },
      {
        label: 'Plans ready',
        detail: plans.length
          ? `${plans.length} plan${plans.length === 1 ? '' : 's'} available for checkout creation.`
          : 'Create at least one plan for the normal purchase flow.',
        ready: plans.length > 0,
        section: 'plans',
      },
      {
        label: 'Payments live',
        detail: confirmedCount
          ? `${confirmedCount} confirmed payment${confirmedCount === 1 ? '' : 's'} recorded.`
          : 'No confirmed payments yet.',
        ready: confirmedCount > 0,
        section: 'payments',
      },
    ]
  }, [merchant, payments])

  const completedSetup = checklist.filter((item) => item.ready).length
  const operationsConfigured = (merchant.enabledChains || []).filter((chain) =>
    merchantSettlementConfigured(merchant, chain),
  ).length
  const locked = Boolean(
    appConfig?.dashboardAuthConfigured && !dashboardData?.authenticated,
  )

  const dashboardPageContextValue = useMemo(
    () => ({
      activeSection,
      addPlan,
      appConfig,
      applySelectedPlan,
      checkoutDraft,
      checkoutStatus,
      checklist,
      completedSetup,
      createCheckout,
      createdCheckout,
      dashboardData,
      editingEnabled,
      expandedPlanIndex,
      exportPayments,
      filteredPayments,
      filteredVolume,
      merchant,
      merchantDraft,
      merchantStatus,
      openCheckouts,
      operationsConfigured,
      patchPaymentFilter,
      paymentFilter,
      payments,
      removePlan,
      saveMerchant,
      setActiveSection,
      setCheckoutField,
      setExpandedPlanIndex,
      setMerchantDefaultRail,
      setMerchantField,
      setMerchantRecipientAddress,
      setPlanRail,
      syncCheckoutRail,
      totalConfirmedVolume,
      updatePlan,
      uploadLogo,
      duplicatePlan,
    }),
    [
      activeSection,
      addPlan,
      appConfig,
      applySelectedPlan,
      checkoutDraft,
      checkoutStatus,
      checklist,
      completedSetup,
      createCheckout,
      createdCheckout,
      dashboardData,
      duplicatePlan,
      editingEnabled,
      expandedPlanIndex,
      exportPayments,
      filteredPayments,
      filteredVolume,
      merchant,
      merchantDraft,
      merchantStatus,
      openCheckouts,
      operationsConfigured,
      patchPaymentFilter,
      paymentFilter,
      payments,
      removePlan,
      saveMerchant,
      setActiveSection,
      setCheckoutField,
      setExpandedPlanIndex,
      setMerchantDefaultRail,
      setMerchantField,
      setMerchantRecipientAddress,
      setPlanRail,
      syncCheckoutRail,
      totalConfirmedVolume,
      updatePlan,
      uploadLogo,
    ],
  )

  return (
    <div className="dashboard-page">
      <div className="atmosphere atmosphere-a"></div>
      <div className="atmosphere atmosphere-b"></div>

      <main className="dashboard-shell">
        {locked ? (
          <>
            <section className="card dashboard-topbar">
              <div className="stack-sm">
                <span className="eyebrow">Charge With Crypto</span>
                <h1>Merchant dashboard</h1>
                <p className="muted">
                  Enter the configured dashboard token to load merchant
                  settings, plans, checkouts, products, and payments.
                </p>
              </div>
              <div className="dashboard-actions">
                <a className="link-button" href="/">
                  Home
                </a>
              </div>
            </section>

            <DashboardAuthGate
              authInput={authInput}
              authStatus={authStatus}
              description="This dashboard does not expose a public read-only mode."
              eyebrow="Access required"
              submitLabel="Unlock dashboard"
              title="Enter dashboard token"
              onAuthInputChange={setAuthInput}
              onSubmit={async () => unlockDashboard(authInput)}
            />
          </>
        ) : (
          <DashboardPageProvider value={dashboardPageContextValue}>
            <DashboardTopbar
              deployedAppUrl={appConfig?.deployedAppUrl}
              description="Use the left menu to manage brand, plans, checkout creation, payments, and activity one section at a time."
            />

            <section className="dashboard-layout">
              <DashboardSidebar />

              <div className="dashboard-main">
                <DashboardOverviewSection />
                <DashboardBrandSection />
                <DashboardWebhooksSection />
                <DashboardSettlementSection />
                <DashboardPlansSection />
                <DashboardCheckoutSection />
                <DashboardPaymentsSection />
                <DashboardActivitySection />
              </div>
            </section>
          </DashboardPageProvider>
        )}
      </main>
    </div>
  )
}
