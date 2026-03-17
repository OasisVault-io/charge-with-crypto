import { type CheckoutLike } from '../shared/types'

class ManualPaymentPresenter {
	readStatus: () => Record<string, unknown>
	readCheckoutDetails: (checkout: CheckoutLike) => Promise<Record<string, unknown>>

	constructor({
		readStatus,
		readCheckoutDetails,
	}: {
		readStatus: () => Record<string, unknown>
		readCheckoutDetails: (
			checkout: CheckoutLike,
		) => Promise<Record<string, unknown>>
	}) {
		this.readStatus = readStatus
		this.readCheckoutDetails = readCheckoutDetails
	}

	status() {
		return this.readStatus()
	}

	getCheckoutDetails(checkout: CheckoutLike) {
		return this.readCheckoutDetails(checkout)
	}
}

export { ManualPaymentPresenter }
