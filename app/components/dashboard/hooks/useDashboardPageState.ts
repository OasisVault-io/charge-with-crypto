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
  checkoutStatus: string
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
      type: 'checkout_status_set'
      value: string
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
  | {
      type: 'payment_filter_patch'
      patch: Partial<PaymentFilterState>
    }
  | {
      type: 'merchant_field_set'
      field: keyof DashboardMerchantDraft
      value: DashboardMerchantDraft[keyof DashboardMerchantDraft]
    }
  | {
      type: 'merchant_recipient_address_set'
      chain: string
      value: string
    }
  | {
      type: 'merchant_default_rail_set'
      nextRail: string
      appConfig: DashboardConfig | null | undefined
    }
  | {
      type: 'checkout_field_set'
      field: keyof DashboardCheckoutDraft
      value: DashboardCheckoutDraft[keyof DashboardCheckoutDraft]
    }
  | {
      type: 'checkout_sync_rail'
      nextRail: string
      appConfig: DashboardConfig | null | undefined
    }
  | {
      type: 'plan_update'
      index: number
      patch: Partial<DashboardMerchantDraft['plans'][number]>
    }
  | {
      type: 'plan_set_rail'
      index: number
      nextRail: string
      appConfig: DashboardConfig | null | undefined
    }
  | {
      type: 'plan_add'
      appConfig: DashboardConfig | null | undefined
    }
  | {
      type: 'plan_duplicate'
      index: number
    }
  | {
      type: 'plan_remove'
      index: number
    }
  | {
      type: 'apply_selected_plan'
      planId: string
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
    checkoutStatus: '',
    merchantStatus: '',
    authStatus: '',
    expandedPlanIndex: null,
    paymentFilter: defaultPaymentFilter,
  }
}

const applyMerchantDefaultRail = (
  merchantDraft: DashboardMerchantDraft,
  nextRail: string,
  appConfig: DashboardConfig | null | undefined,
) => {
  const normalizedRail = normalizePaymentRail(nextRail)
  const nextAssets = valuesForRail(
    merchantDraft.defaultAcceptedAssets,
    normalizedRail,
    'asset',
  )
  return {
    ...merchantDraft,
    defaultPaymentRail: normalizedRail,
    defaultAcceptedAssets: nextAssets.length
      ? nextAssets
      : defaultRailSelection(appConfig, normalizedRail, 'asset'),
  }
}

const applyCheckoutRail = (
  state: DashboardPageState,
  nextRail: string,
  appConfig: DashboardConfig | null | undefined,
) => {
  const normalizedRail = normalizePaymentRail(nextRail)
  const merchantChainDefaults = valuesForRail(
    state.merchantDraft.enabledChains,
    normalizedRail,
    'chain',
  )
  const merchantAssetDefaults = valuesForRail(
    state.merchantDraft.defaultAcceptedAssets,
    normalizedRail,
    'asset',
  )
  const enabledChains = valuesForRail(
    state.checkoutDraft.enabledChains,
    normalizedRail,
    'chain',
  )
  const acceptedAssets = valuesForRail(
    state.checkoutDraft.acceptedAssets,
    normalizedRail,
    'asset',
  )
  return {
    ...state.checkoutDraft,
    paymentRail: normalizedRail,
    enabledChains: enabledChains.length
      ? enabledChains
      : merchantChainDefaults.length
        ? merchantChainDefaults
        : defaultRailSelection(appConfig, normalizedRail, 'chain'),
    acceptedAssets: acceptedAssets.length
      ? acceptedAssets
      : merchantAssetDefaults.length
        ? merchantAssetDefaults
        : defaultRailSelection(appConfig, normalizedRail, 'asset'),
  }
}

const applyPlanRail = (
  plan: DashboardMerchantDraft['plans'][number],
  nextRail: string,
  appConfig: DashboardConfig | null | undefined,
) => {
  const normalizedRail = normalizePaymentRail(nextRail)
  const enabledChains = valuesForRail(
    plan.enabledChains,
    normalizedRail,
    'chain',
  )
  const acceptedAssets = valuesForRail(
    plan.acceptedAssets,
    normalizedRail,
    'asset',
  )
  return {
    ...plan,
    paymentRail: normalizedRail,
    enabledChains: enabledChains.length
      ? enabledChains
      : defaultRailSelection(appConfig, normalizedRail, 'chain'),
    acceptedAssets: acceptedAssets.length
      ? acceptedAssets
      : defaultRailSelection(appConfig, normalizedRail, 'asset'),
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
    case 'checkout_status_set':
      return {
        ...state,
        checkoutStatus: action.value,
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
    case 'payment_filter_patch':
      return {
        ...state,
        paymentFilter: { ...state.paymentFilter, ...action.patch },
      }
    case 'merchant_field_set':
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          [action.field]: action.value,
        },
      }
    case 'merchant_recipient_address_set':
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          recipientAddresses: {
            ...state.merchantDraft.recipientAddresses,
            [action.chain]: action.value,
          },
        },
      }
    case 'merchant_default_rail_set':
      return {
        ...state,
        merchantDraft: applyMerchantDefaultRail(
          state.merchantDraft,
          action.nextRail,
          action.appConfig,
        ),
      }
    case 'checkout_field_set':
      return {
        ...state,
        checkoutDraft: {
          ...state.checkoutDraft,
          [action.field]: action.value,
        },
      }
    case 'checkout_sync_rail':
      return {
        ...state,
        checkoutDraft: applyCheckoutRail(
          state,
          action.nextRail,
          action.appConfig,
        ),
      }
    case 'plan_update': {
      if (!state.merchantDraft.plans[action.index]) return state
      const plans = [...state.merchantDraft.plans]
      plans[action.index] = { ...plans[action.index], ...action.patch }
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          plans,
        },
      }
    }
    case 'plan_set_rail': {
      const plan = state.merchantDraft.plans[action.index]
      if (!plan) return state
      const plans = [...state.merchantDraft.plans]
      plans[action.index] = applyPlanRail(
        plan,
        action.nextRail,
        action.appConfig,
      )
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          plans,
        },
      }
    }
    case 'plan_add':
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          plans: [...state.merchantDraft.plans, newPlan(action.appConfig)],
        },
        expandedPlanIndex: state.merchantDraft.plans.length,
      }
    case 'plan_duplicate': {
      const plan = state.merchantDraft.plans[action.index]
      if (!plan) return state
      const duplicate = {
        ...plan,
        id: `${plan.id || 'plan'}_${Math.random().toString(36).slice(2, 6)}`,
      }
      const plans = [...state.merchantDraft.plans]
      plans.splice(action.index + 1, 0, duplicate)
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          plans,
        },
        expandedPlanIndex: action.index + 1,
      }
    }
    case 'plan_remove': {
      const plans = state.merchantDraft.plans.filter(
        (_, planIndex) => planIndex !== action.index,
      )
      return {
        ...state,
        merchantDraft: {
          ...state.merchantDraft,
          plans,
        },
        expandedPlanIndex:
          state.expandedPlanIndex === action.index
            ? null
            : state.expandedPlanIndex != null &&
                state.expandedPlanIndex > action.index
              ? state.expandedPlanIndex - 1
              : state.expandedPlanIndex,
      }
    }
    case 'apply_selected_plan': {
      const plan = state.merchantDraft.plans.find(
        (entry) => entry.id === action.planId,
      )
      if (!plan) {
        return {
          ...state,
          checkoutDraft: {
            ...state.checkoutDraft,
            planId: action.planId,
          },
        }
      }
      return {
        ...state,
        checkoutDraft: {
          ...state.checkoutDraft,
          planId: action.planId,
          title: plan.title || '',
          description: plan.description || '',
          paymentRail: normalizePaymentRail(plan.paymentRail),
          amountUsd: Number(plan.amountUsd || 0).toFixed(2),
          enabledChains: plan.enabledChains || [],
          acceptedAssets: plan.acceptedAssets || [],
        },
      }
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
    setCheckoutStatus: useCallback((value: string) => {
      dispatch({ type: 'checkout_status_set', value })
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
    patchPaymentFilter: useCallback((patch: Partial<PaymentFilterState>) => {
      dispatch({ type: 'payment_filter_patch', patch })
    }, []),
    setMerchantField: useCallback(<K extends keyof DashboardMerchantDraft>(
      field: K,
      value: DashboardMerchantDraft[K],
    ) => {
      dispatch({
        type: 'merchant_field_set',
        field,
        value,
      })
    }, []),
    setMerchantRecipientAddress: useCallback((chain: string, value: string) => {
      dispatch({
        type: 'merchant_recipient_address_set',
        chain,
        value,
      })
    }, []),
    setMerchantDefaultRail: useCallback((nextRail: string) => {
      dispatch({ type: 'merchant_default_rail_set', nextRail, appConfig })
    }, [appConfig]),
    setCheckoutField: useCallback(<K extends keyof DashboardCheckoutDraft>(
      field: K,
      value: DashboardCheckoutDraft[K],
    ) => {
      dispatch({
        type: 'checkout_field_set',
        field,
        value,
      })
    }, []),
    syncCheckoutRail: useCallback((nextRail: string) => {
      dispatch({ type: 'checkout_sync_rail', nextRail, appConfig })
    }, [appConfig]),
    updatePlan: useCallback((
      index: number,
      patch: Partial<DashboardMerchantDraft['plans'][number]>,
    ) => {
      dispatch({
        type: 'plan_update',
        index,
        patch,
      })
    }, []),
    setPlanRail: useCallback((index: number, nextRail: string) => {
      dispatch({
        type: 'plan_set_rail',
        index,
        nextRail,
        appConfig,
      })
    }, [appConfig]),
    addPlan: useCallback(() => {
      dispatch({ type: 'plan_add', appConfig })
    }, [appConfig]),
    duplicatePlan: useCallback((index: number) => {
      dispatch({ type: 'plan_duplicate', index })
    }, []),
    removePlan: useCallback((index: number) => {
      dispatch({ type: 'plan_remove', index })
    }, []),
    applySelectedPlan: useCallback((planId: string) => {
      dispatch({ type: 'apply_selected_plan', planId })
    }, []),
  }
}
