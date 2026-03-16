// @ts-nocheck
declare global {
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
		}
	}
}

export {}
