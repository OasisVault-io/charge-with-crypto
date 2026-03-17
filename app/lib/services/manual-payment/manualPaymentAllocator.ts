import {
	type CheckoutLike,
	type ManualPaymentLike,
	type MerchantLike,
	type QuoteLike,
} from '../shared/types'

type CreateManualPaymentInput = {
	merchant: MerchantLike
	checkout: CheckoutLike
	quotes: QuoteLike[]
}

class ManualPaymentAllocator {
	createManualPayment: (
		input: CreateManualPaymentInput,
	) => Promise<ManualPaymentLike>

	constructor({
		createManualPayment,
	}: {
		createManualPayment: (
			input: CreateManualPaymentInput,
		) => Promise<ManualPaymentLike>
	}) {
		this.createManualPayment = createManualPayment
	}

	createCheckoutManualPayment(input: CreateManualPaymentInput) {
		return this.createManualPayment(input)
	}
}

export { ManualPaymentAllocator }
