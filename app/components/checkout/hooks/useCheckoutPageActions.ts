import { useEffectEvent } from 'react'

import { fetchJson, jsonRequest } from '../../../lib/browser/api'
import { chainHex, isQuotePayable } from '../checkout.shared'
import {
	type CheckoutConfig,
	type CheckoutManualDetails,
	type CheckoutManualRoute,
	type CheckoutQuote,
	type CheckoutRecord,
	type CheckoutViewState,
	type WalletProviderOption,
	type WalletSession,
} from '../checkout.types'

type UseCheckoutPageActionsParams = {
	applyWalletConnected: (
		session: WalletSession,
		balances: NonNullable<CheckoutViewState['balances']>,
	) => void
	availableWalletProviders: WalletProviderOption[]
	checkout: CheckoutRecord | null | undefined
	checkoutId: string
	config: CheckoutConfig | null | undefined
	hasManualPayment: boolean
	manualDetailsLoaded: (details: CheckoutManualDetails) => void
	manualPanelOpen: boolean
	openManualPanel: () => void
	quotesRefreshed: (refreshed: CheckoutViewState) => void
	recommendedQuote: CheckoutQuote | null
	selectedManualRoute: CheckoutManualRoute | null
	setBusy: (isBusy: boolean) => void
	setStatusMessage: (message: string) => void
	statusRefreshed: (next: CheckoutViewState) => void
	viewState: CheckoutViewState
	walletDisconnected: () => void
	walletSession: WalletSession | null
}

const errorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message) return error.message
	return fallback
}

export const useCheckoutPageActions = ({
	applyWalletConnected,
	availableWalletProviders,
	checkout,
	checkoutId,
	config,
	hasManualPayment,
	manualDetailsLoaded,
	manualPanelOpen,
	openManualPanel: showManualPanel,
	quotesRefreshed,
	recommendedQuote,
	selectedManualRoute,
	setBusy,
	setStatusMessage,
	statusRefreshed,
	viewState,
	walletDisconnected,
	walletSession,
}: UseCheckoutPageActionsParams) => {
	const refreshStatus = useEffectEvent(async () => {
		const next = await fetchJson<CheckoutViewState>(
			`/api/checkouts/${checkoutId}/status`,
		)
		statusRefreshed(next)
	})

	const loadManualDetails = async () => {
		if (!hasManualPayment) return null
		const details = await fetchJson<CheckoutManualDetails>(
			`/api/checkouts/${checkoutId}/manual-payment`,
		)
		manualDetailsLoaded(details)
		return details
	}

	const openManualPanel = async () => {
		setStatusMessage('')
		if (!hasManualPayment) return
		if (!viewState?.manualDetails) {
			await loadManualDetails()
		}
		showManualPanel()
	}

	const copyManualAddress = async () => {
		const address =
			selectedManualRoute?.address ||
			viewState?.manualDetails?.address ||
			checkout?.manualPayment?.address
		if (!address) {
			setStatusMessage('Manual address unavailable.')
			return
		}
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(address)
			setStatusMessage('Manual address copied.')
			window.setTimeout(() => setStatusMessage(''), 1200)
		}
	}

	const connectWallet = async (
		providerId = availableWalletProviders[0]?.id || '',
	) => {
		if (!providerId) {
			setStatusMessage('No wallet provider is available for this checkout.')
			return
		}
		setBusy(true)
		setStatusMessage('')
		try {
			let session: WalletSession
			if (providerId === 'xverse') {
				const xverse = window.ChargeWithCryptoVendors?.xverse
				if (!xverse?.request || !xverse?.setDefaultProvider) {
					throw new Error('xverse wallet adapter unavailable')
				}
				const provider = xverse.DefaultAdaptersInfo?.xverse?.id
				if (provider) xverse.setDefaultProvider(provider)
				let response = await xverse.request('wallet_connect', {
					addresses: ['payment'],
					network: 'Mainnet',
					message:
						'Charge With Crypto wants to connect your Bitcoin payment address.',
				})
				let accounts = Array.isArray(response?.result?.addresses)
					? response.result.addresses
					: Array.isArray(response?.result)
						? response.result
						: []
				if (!accounts.length && xverse.AddressPurpose) {
					response = await xverse.request('getAccounts', {
						purposes: [xverse.AddressPurpose.Payment],
						message:
							'Charge With Crypto wants to connect your Bitcoin payment address.',
					})
					accounts = Array.isArray(response?.result?.addresses)
						? response.result.addresses
						: Array.isArray(response?.result)
							? response.result
							: []
				}
				if (response?.status === 'error') {
					throw new Error(
						response?.error?.message || 'xverse address request failed',
					)
				}
				const paymentAccount =
					accounts.find(
						(account: { purpose?: string }) =>
							String(account.purpose).toLowerCase() === 'payment',
					) || accounts[0]
				if (!paymentAccount?.address) {
					throw new Error('xverse did not return a payment address')
				}
				session = {
					rail: 'bitcoin',
					provider: 'xverse',
					address: paymentAccount.address,
				}
			} else {
				if (!window.ethereum?.request) {
					throw new Error('no injected wallet found')
				}
				const accounts = (await window.ethereum.request({
					method: 'eth_requestAccounts',
				})) as string[]
				const address = accounts?.[0]
				if (!address) throw new Error('wallet did not return an address')
				session = { rail: 'evm', provider: 'injected-evm', address }
			}

			const scan = await fetchJson<CheckoutViewState>(
				`/api/checkouts/${checkoutId}/balance-scan`,
				jsonRequest(
					{ walletAddress: session.address, walletRail: session.rail },
					{ method: 'POST' },
				),
			)
			const scannedBalances = Object.values(scan.balances || {})
			const hasDetectedBalance = scannedBalances.some((entry) => {
				const raw = entry?.raw
				if (raw == null) return false
				try {
					return BigInt(raw) > 0n
				} catch {
					return false
				}
			})
			applyWalletConnected(session, scan.balances || {})
			setStatusMessage(
				hasDetectedBalance
					? 'Wallet connected. Route scan updated.'
					: 'Wallet connected. No supported balance was detected on this checkout yet.',
			)
		} catch (error: unknown) {
			setStatusMessage(errorMessage(error, 'Wallet connection failed.'))
		} finally {
			setBusy(false)
		}
	}

	const refreshQuote = async () => {
		setBusy(true)
		setStatusMessage('')
		try {
			const quote = recommendedQuote
			const refreshed = await fetchJson<CheckoutViewState>(
				`/api/checkouts/${checkoutId}/quote`,
				jsonRequest(quote ? { chain: quote.chain, asset: quote.asset } : {}, {
					method: 'POST',
				}),
			)
			quotesRefreshed(refreshed)
			if (manualPanelOpen) await loadManualDetails()
		} catch (error: unknown) {
			setStatusMessage(errorMessage(error, 'Could not refresh prices.'))
		} finally {
			setBusy(false)
		}
	}

	const submitTx = async (
		txHash: string,
		walletAddress: string,
		quote: CheckoutQuote,
	) => {
		await fetchJson(
			`/api/checkouts/${checkoutId}/submit-tx`,
			jsonRequest(
				{
					txHash,
					walletAddress,
					chain: quote.chain,
					asset: quote.asset,
					quoteId: quote.id,
				},
				{ method: 'POST' },
			),
		)
		await refreshStatus()
	}

	const payWithWallet = async () => {
		if (!recommendedQuote) {
			setStatusMessage('No compatible quote is available.')
			return
		}
		if (!isQuotePayable(viewState?.balances, recommendedQuote)) {
			setStatusMessage('Not enough balance on the recommended route.')
			return
		}

		setBusy(true)
		setStatusMessage('')

		try {
			if (walletSession?.provider === 'xverse') {
				const xverse = window.ChargeWithCryptoVendors?.xverse
				if (!xverse?.request || !xverse?.setDefaultProvider) {
					throw new Error('xverse wallet adapter unavailable')
				}
				const provider = xverse.DefaultAdaptersInfo?.xverse?.id
				if (provider) xverse.setDefaultProvider(provider)
				const amount = Number(recommendedQuote.cryptoAmountBaseUnits)
				if (!Number.isSafeInteger(amount)) {
					throw new Error('bitcoin amount exceeds safe integer range')
				}
				const response = await xverse.request('sendTransfer', {
					recipients: [
						{
							address:
								checkout?.recipientByChain?.bitcoin ||
								checkout?.recipientAddress,
							amount,
						},
					],
				})
				if (response?.status === 'error') {
					throw new Error(response?.error?.message || 'xverse transfer failed')
				}
				const txid = response?.result?.txid || response?.txid
				if (!txid) throw new Error('xverse transfer did not return a txid')
				await submitTx(txid, walletSession.address, recommendedQuote)
			} else {
				if (!window.ethereum?.request) {
					throw new Error('no injected wallet found')
				}
				const accounts = (await window.ethereum.request({
					method: 'eth_requestAccounts',
				})) as string[]
				const walletAddress = accounts?.[0]
				if (!walletAddress) throw new Error('wallet did not return an address')

				const chainConfig = config?.chains?.[recommendedQuote.chain]
				const recipientAddress =
					checkout?.recipientByChain?.[recommendedQuote.chain] ||
					checkout?.recipientAddress
				if (!chainConfig || !recipientAddress) {
					throw new Error('route configuration is incomplete')
				}
				await window.ethereum.request({
					method: 'wallet_switchEthereumChain',
					params: [{ chainId: chainHex(chainConfig.chainId) }],
				})

				let txHash
				if (recommendedQuote.asset === 'ETH') {
					txHash = (await window.ethereum.request({
						method: 'eth_sendTransaction',
						params: [
							{
								from: walletAddress,
								to: recipientAddress,
								value: `0x${BigInt(recommendedQuote.cryptoAmountBaseUnits).toString(16)}`,
							},
						],
					})) as string
				} else {
					const tokenAddress =
						config?.assets?.[recommendedQuote.asset]?.addresses?.[
							recommendedQuote.chain
						]
					if (!tokenAddress) {
						throw new Error('token contract address unavailable')
					}
					const methodId = '0xa9059cbb'
					const toArg = recipientAddress
						.toLowerCase()
						.replace(/^0x/, '')
						.padStart(64, '0')
					const amountArg = BigInt(recommendedQuote.cryptoAmountBaseUnits)
						.toString(16)
						.padStart(64, '0')
					txHash = (await window.ethereum.request({
						method: 'eth_sendTransaction',
						params: [
							{
								from: walletAddress,
								to: tokenAddress,
								data: `${methodId}${toArg}${amountArg}`,
							},
						],
					})) as string
				}

				await submitTx(txHash, walletAddress, recommendedQuote)
			}
		} catch (error: unknown) {
			setStatusMessage(errorMessage(error, 'Payment submission failed.'))
		} finally {
			setBusy(false)
		}
	}

	const disconnectWallet = () => {
		walletDisconnected()
	}

	return {
		connectWallet,
		copyManualAddress,
		disconnectWallet,
		loadManualDetails,
		openManualPanel,
		payWithWallet,
		refreshQuote,
		refreshStatus,
	}
}
