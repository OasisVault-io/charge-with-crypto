import { useReducer, useCallback } from 'react'

import {
  createCheckoutDraft,
  createMerchantDraft,
  defaultRailSelection,
  newPlan,
  normalizePaymentRail,
  valuesForRail,
  type DashboardSection,
  type PaymentFilterState,
} from '../dashboard.shared'
import {
  type DashboardCheckoutDraft,
  type DashboardConfig,
  type DashboardCreatedCheckout,
  type DashboardData,
  type DashboardMerchantDraft,
} from '../dashboard.types'

type DashboardPageState = {
  dashboardData: DashboardData
  dashboardToken: string
  authInput: string
  activeSection: DashboardSection
  merchantDraft: DashboardMerchantDraft
  checkoutDraft: DashboardCheckoutDraft
  createdCheckout: DashboardCreatedCheckout | null
  merchantStatus: string
  authStatus: string
  expandedPlanIndex: number | null
  paymentFilter: PaymentFilterState
}

type DashboardPageAction =
  | {
      type: 'hydrate'
      initialData: DashboardData
      appConfig: DashboardConfig | null | undefined
    }
  | {
      type: 'dashboard_reloaded'
      next: DashboardData
      appConfig: DashboardConfig | null | undefined
    }
  | {
      type: 'dashboard_token_set'
      value: string
    }
  | {
      type: 'auth_input_set'
      value: string
    }
  | {
      type: 'active_section_set'
      section: DashboardSection
    }
  | {
      type: 'merchant_draft_set'
      draft: DashboardMerchantDraft
    }
  | {
      type: 'checkout_draft_set'
      draft: DashboardCheckoutDraft
    }
  | {
      type: 'created_checkout_set'
      value: DashboardCreatedCheckout | null
    }
  | {
      type: 'merchant_status_set'
      value: string
    }
  | {
      type: 'auth_status_set'
      value: string
    }
  | {
      type: 'expanded_plan_index_set'
      value: number | null
    }
  | {
      type: 'payment_filter_set'
      value: PaymentFilterState
    }

const defaultPaymentFilter: PaymentFilterState = {
  search: '',
  status: 'all',
  method: 'all',
  range: '30d',
}

const createDashboardPageState = (
  initialData: DashboardData,
  appConfig: DashboardConfig | null | undefined,
): DashboardPageState => {
  return {
    dashboardData: initialData,
    dashboardToken: '',
    authInput: '',
    activeSection: 'overview',
    merchantDraft: createMerchantDraft(initialData?.merchant, appConfig),
    checkoutDraft: createCheckoutDraft(initialData?.merchant, appConfig),
    createdCheckout: null,
    merchantStatus: '',
    authStatus: '',
    expandedPlanIndex: null,
    paymentFilter: defaultPaymentFilter,
  }
}

const dashboardPageReducer = (
  state: DashboardPageState,
  action: DashboardPageAction,
): DashboardPageState => {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        dashboardData: action.initialData,
        merchantDraft: createMerchantDraft(
          action.initialData?.merchant,
          action.appConfig,
        ),
        checkoutDraft: createCheckoutDraft(
          action.initialData?.merchant,
          action.appConfig,
        ),
      }
    case 'dashboard_reloaded':
      return {
        ...state,
        dashboardData: action.next,
        merchantDraft: createMerchantDraft(
          action.next?.merchant,
          action.appConfig,
        ),
        checkoutDraft: createCheckoutDraft(
          action.next?.merchant,
          action.appConfig,
        ),
        createdCheckout: null,
      }
    case 'dashboard_token_set':
      return {
        ...state,
        dashboardToken: action.value,
      }
    case 'auth_input_set':
      return {
        ...state,
        authInput: action.value,
      }
    case 'active_section_set':
      return {
        ...state,
        activeSection: action.section,
      }
    case 'merchant_draft_set':
      return {
        ...state,
        merchantDraft: action.draft,
      }
    case 'checkout_draft_set':
      return {
        ...state,
        checkoutDraft: action.draft,
      }
    case 'created_checkout_set':
      return {
        ...state,
        createdCheckout: action.value,
      }
    case 'merchant_status_set':
      return {
        ...state,
        merchantStatus: action.value,
      }
    case 'auth_status_set':
      return {
        ...state,
        authStatus: action.value,
      }
    case 'expanded_plan_index_set':
      return {
        ...state,
        expandedPlanIndex: action.value,
      }
    case 'payment_filter_set':
      return {
        ...state,
        paymentFilter: action.value,
      }
    default:
      return state
  }
}

export const useDashboardPageState = (
  initialData: DashboardData,
  appConfig: DashboardConfig | null | undefined,
) => {
  const [state, dispatch] = useReducer(
    dashboardPageReducer,
    { initialData, appConfig },
    ({ initialData: nextInitialData, appConfig: nextAppConfig }) =>
      createDashboardPageState(nextInitialData, nextAppConfig),
  )

  const setMerchantDraft = (draft: DashboardMerchantDraft) => {
    dispatch({ type: 'merchant_draft_set', draft })
  }

  const setCheckoutDraft = (draft: DashboardCheckoutDraft) => {
    dispatch({ type: 'checkout_draft_set', draft })
  }

  return {
    state,
    hydrate: useCallback((
      initialData: DashboardData,
      nextAppConfig: DashboardConfig | null | undefined,
    ) => {
      dispatch({ type: 'hydrate', initialData, appConfig: nextAppConfig })
    }, []),
    dashboardReloaded: useCallback((
      next: DashboardData,
      nextAppConfig: DashboardConfig | null | undefined,
    ) => {
      dispatch({ type: 'dashboard_reloaded', next, appConfig: nextAppConfig })
    }, []),
    setDashboardToken: useCallback((value: string) => {
      dispatch({ type: 'dashboard_token_set', value })
    }, []),
    clearDashboardToken: useCallback(() => {
      dispatch({ type: 'dashboard_token_set', value: '' })
    }, []),
    setAuthInput: useCallback((value: string) => {
      dispatch({ type: 'auth_input_set', value })
    }, []),
    setActiveSection: useCallback((section: DashboardSection) => {
      dispatch({ type: 'active_section_set', section })
    }, []),
    setCreatedCheckout: useCallback((value: DashboardCreatedCheckout | null) => {
      dispatch({ type: 'created_checkout_set', value })
    }, []),
    setMerchantStatus: useCallback((value: string) => {
      dispatch({ type: 'merchant_status_set', value })
    }, []),
    setAuthStatus: useCallback((value: string) => {
      dispatch({ type: 'auth_status_set', value })
    }, []),
    setExpandedPlanIndex: useCallback((value: number | null) => {
      dispatch({ type: 'expanded_plan_index_set', value })
    }, []),
    setPaymentFilter: useCallback((value: PaymentFilterState) => {
      dispatch({ type: 'payment_filter_set', value })
    }, []),
    patchPaymentFilter(patch: Partial<PaymentFilterState>) {
      dispatch({
        type: 'payment_filter_set',
        value: { ...state.paymentFilter, ...patch },
      })
    },
    setMerchantField<K extends keyof DashboardMerchantDraft>(
      field: K,
      value: DashboardMerchantDraft[K],
    ) {
      setMerchantDraft({
        ...state.merchantDraft,
        [field]: value,
      })
    },
    setMerchantRecipientAddress(chain: string, value: string) {
      setMerchantDraft({
        ...state.merchantDraft,
        recipientAddresses: {
          ...state.merchantDraft.recipientAddresses,
          [chain]: value,
        },
      })
    },
    setMerchantDefaultRail(nextRail: string) {
      const normalizedRail = normalizePaymentRail(nextRail)
      const nextAssets = valuesForRail(
        state.merchantDraft.defaultAcceptedAssets,
        normalizedRail,
        'asset',
      )
      setMerchantDraft({
        ...state.merchantDraft,
        defaultPaymentRail: normalizedRail,
        defaultAcceptedAssets: nextAssets.length
          ? nextAssets
          : defaultRailSelection(appConfig, normalizedRail, 'asset'),
      })
    },
    setCheckoutField<K extends keyof DashboardCheckoutDraft>(
      field: K,
      value: DashboardCheckoutDraft[K],
    ) {
      setCheckoutDraft({
        ...state.checkoutDraft,
        [field]: value,
      })
    },
    syncCheckoutRail(nextRail: string) {
      const merchantChainDefaults = valuesForRail(
        state.merchantDraft.enabledChains,
        nextRail,
        'chain',
      )
      const merchantAssetDefaults = valuesForRail(
        state.merchantDraft.defaultAcceptedAssets,
        nextRail,
        'asset',
      )
      const enabledChains = valuesForRail(
        state.checkoutDraft.enabledChains,
        nextRail,
        'chain',
      )
      const acceptedAssets = valuesForRail(
        state.checkoutDraft.acceptedAssets,
        nextRail,
        'asset',
      )
      setCheckoutDraft({
        ...state.checkoutDraft,
        paymentRail: nextRail,
        enabledChains: enabledChains.length
          ? enabledChains
          : merchantChainDefaults.length
            ? merchantChainDefaults
            : defaultRailSelection(appConfig, nextRail, 'chain'),
        acceptedAssets: acceptedAssets.length
          ? acceptedAssets
          : merchantAssetDefaults.length
            ? merchantAssetDefaults
            : defaultRailSelection(appConfig, nextRail, 'asset'),
      })
    },
    updatePlan(
      index: number,
      patch: Partial<DashboardMerchantDraft['plans'][number]>,
    ) {
      const plans = [...state.merchantDraft.plans]
      plans[index] = { ...plans[index], ...patch }
      setMerchantDraft({
        ...state.merchantDraft,
        plans,
      })
    },
    setPlanRail(index: number, nextRail: string) {
      const plan = state.merchantDraft.plans[index]
      if (!plan) return
      const enabledChains = valuesForRail(plan.enabledChains, nextRail, 'chain')
      const acceptedAssets = valuesForRail(
        plan.acceptedAssets,
        nextRail,
        'asset',
      )
      const plans = [...state.merchantDraft.plans]
      plans[index] = {
        ...plan,
        paymentRail: nextRail,
        enabledChains: enabledChains.length
          ? enabledChains
          : defaultRailSelection(appConfig, nextRail, 'chain'),
        acceptedAssets: acceptedAssets.length
          ? acceptedAssets
          : defaultRailSelection(appConfig, nextRail, 'asset'),
      }
      setMerchantDraft({
        ...state.merchantDraft,
        plans,
      })
    },
    addPlan() {
      setMerchantDraft({
        ...state.merchantDraft,
        plans: [...state.merchantDraft.plans, newPlan(appConfig)],
      })
      dispatch({
        type: 'expanded_plan_index_set',
        value: state.merchantDraft.plans.length,
      })
    },
    duplicatePlan(index: number) {
      const plan = state.merchantDraft.plans[index]
      if (!plan) return
      const duplicate = {
        ...plan,
        id: `${plan.id || 'plan'}_${Math.random().toString(36).slice(2, 6)}`,
      }
      const plans = [...state.merchantDraft.plans]
      plans.splice(index + 1, 0, duplicate)
      setMerchantDraft({
        ...state.merchantDraft,
        plans,
      })
      dispatch({
        type: 'expanded_plan_index_set',
        value: index + 1,
      })
    },
    removePlan(index: number) {
      setMerchantDraft({
        ...state.merchantDraft,
        plans: state.merchantDraft.plans.filter(
          (_, planIndex) => planIndex !== index,
        ),
      })
      dispatch({
        type: 'expanded_plan_index_set',
        value:
          state.expandedPlanIndex === index
            ? null
            : state.expandedPlanIndex != null && state.expandedPlanIndex > index
              ? state.expandedPlanIndex - 1
              : state.expandedPlanIndex,
      })
    },
    applySelectedPlan(planId: string) {
      const plan = state.merchantDraft.plans.find(
        (entry) => entry.id === planId,
      )
      if (!plan) {
        setCheckoutDraft({
          ...state.checkoutDraft,
          planId,
        })
        return
      }
      setCheckoutDraft({
        ...state.checkoutDraft,
        planId,
        title: plan.title || '',
        description: plan.description || '',
        paymentRail: normalizePaymentRail(plan.paymentRail),
        amountUsd: Number(plan.amountUsd || 0).toFixed(2),
        enabledChains: plan.enabledChains || [],
        acceptedAssets: plan.acceptedAssets || [],
      })
    },
  }
}
