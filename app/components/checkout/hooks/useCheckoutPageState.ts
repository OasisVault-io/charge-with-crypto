import { useReducer } from 'react'

import { quoteKey, safeLogoSrc } from '../checkout.shared'
import {
	type CheckoutBalance,
	type CheckoutManualDetails,
	type CheckoutViewState,
	type WalletSession,
} from '../checkout.types'

type CheckoutPageState = {
	viewState: CheckoutViewState
	walletSession: WalletSession | null
	manualPanelOpen: boolean
	manualSelectedRouteKey: string
	isBusy: boolean
	statusMessage: string
	now: number
	logoSrc: string
}

type CheckoutPageAction =
	| {
			type: 'reset'
			initialData: CheckoutViewState
			now: number
	  }
	| {
			type: 'set_logo_src'
			logoSrc: string
	  }
	| {
			type: 'tick'
			now: number
	  }
	| {
			type: 'set_busy'
			isBusy: boolean
	  }
	| {
			type: 'set_status_message'
			message: string
	  }
	| {
			type: 'status_refreshed'
			next: CheckoutViewState
	  }
	| {
			type: 'manual_details_loaded'
			details: CheckoutManualDetails
	  }
	| {
			type: 'open_manual_panel'
	  }
	| {
			type: 'close_manual_panel'
	  }
	| {
			type: 'wallet_connected'
			session: WalletSession
			balances: Record<string, CheckoutBalance>
	  }
	| {
			type: 'quotes_refreshed'
			refreshed: CheckoutViewState
	  }
	| {
			type: 'wallet_disconnected'
	  }

const createCheckoutPageState = (
	initialData: CheckoutViewState,
	now = Date.now(),
): CheckoutPageState => {
	return {
		viewState: {
			...initialData,
			balances: {},
			manualDetails: null,
		},
		walletSession: null,
		manualPanelOpen: false,
		manualSelectedRouteKey: '',
		isBusy: false,
		statusMessage: '',
		now,
		logoSrc: safeLogoSrc(initialData?.checkout?.merchantLogoUrl),
	}
}

const checkoutPageReducer = (
	state: CheckoutPageState,
	action: CheckoutPageAction,
): CheckoutPageState => {
	switch (action.type) {
		case 'reset':
			return createCheckoutPageState(action.initialData, action.now)
		case 'set_logo_src':
			return {
				...state,
				logoSrc: action.logoSrc,
			}
		case 'tick':
			return {
				...state,
				now: action.now,
			}
		case 'set_busy':
			return {
				...state,
				isBusy: action.isBusy,
			}
		case 'set_status_message':
			return {
				...state,
				statusMessage: action.message,
			}
		case 'status_refreshed':
			return {
				...state,
				viewState: {
					...state.viewState,
					...action.next,
					config: state.viewState?.config,
					balances: state.viewState?.balances || {},
					manualDetails: state.viewState?.manualDetails || null,
				},
			}
		case 'manual_details_loaded':
			return {
				...state,
				viewState: {
					...state.viewState,
					manualDetails: action.details,
				},
				manualSelectedRouteKey:
					state.manualSelectedRouteKey ||
					action.details.preferredRouteKey ||
					'',
			}
		case 'open_manual_panel':
			return {
				...state,
				manualPanelOpen: true,
			}
		case 'close_manual_panel':
			return {
				...state,
				manualPanelOpen: false,
			}
		case 'wallet_connected':
			return {
				...state,
				walletSession: action.session,
				manualPanelOpen: false,
				viewState: {
					...state.viewState,
					balances: {
						...(state.viewState?.balances || {}),
						...action.balances,
					},
				},
			}
		case 'quotes_refreshed': {
			const byRoute = new Map(
				(state.viewState?.quotes || []).map((entry) => [
					quoteKey(entry),
					entry,
				]),
			)
			for (const entry of action.refreshed.quotes || []) {
				byRoute.set(quoteKey(entry), entry)
			}
			return {
				...state,
				viewState: {
					...state.viewState,
					quote: action.refreshed.quote,
					quotes: [...byRoute.values()],
				},
			}
		}
		case 'wallet_disconnected':
			return {
				...state,
				walletSession: null,
				statusMessage: 'Wallet disconnected.',
				viewState: {
					...state.viewState,
					balances: {},
				},
			}
		default:
			return state
	}
}

export const useCheckoutPageState = (initialData: CheckoutViewState) => {
	const [state, dispatch] = useReducer(
		checkoutPageReducer,
		initialData,
		createCheckoutPageState,
	)

	return {
		state,
		reset(initialData: CheckoutViewState, now: number) {
			dispatch({ type: 'reset', initialData, now })
		},
		setLogoSrc(logoSrc: string) {
			dispatch({ type: 'set_logo_src', logoSrc })
		},
		tick(now: number) {
			dispatch({ type: 'tick', now })
		},
		setBusy(isBusy: boolean) {
			dispatch({ type: 'set_busy', isBusy })
		},
		setStatusMessage(message: string) {
			dispatch({ type: 'set_status_message', message })
		},
		statusRefreshed(next: CheckoutViewState) {
			dispatch({ type: 'status_refreshed', next })
		},
		manualDetailsLoaded(details: CheckoutManualDetails) {
			dispatch({ type: 'manual_details_loaded', details })
		},
		openManualPanel() {
			dispatch({ type: 'open_manual_panel' })
		},
		closeManualPanel() {
			dispatch({ type: 'close_manual_panel' })
		},
		walletConnected(
			session: WalletSession,
			balances: Record<string, CheckoutBalance>,
		) {
			dispatch({ type: 'wallet_connected', session, balances })
		},
		quotesRefreshed(refreshed: CheckoutViewState) {
			dispatch({ type: 'quotes_refreshed', refreshed })
		},
		walletDisconnected() {
			dispatch({ type: 'wallet_disconnected' })
		},
	}
}
