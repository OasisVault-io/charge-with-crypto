import { type FeeDataLike, type PaymentLike } from '../shared/types'

class ManualPaymentSweeper {
	processQueue: () => Promise<void>
	sweepOne: (payment: PaymentLike) => Promise<void>
	buildFeeOverrides: (feeData: FeeDataLike) => {
		unitPrice: bigint
		tx: Record<string, bigint | number | string>
	}

	constructor({
		processQueue,
		sweepOne,
		buildFeeOverrides,
	}: {
		processQueue: () => Promise<void>
		sweepOne: (payment: PaymentLike) => Promise<void>
		buildFeeOverrides: (feeData: FeeDataLike) => {
			unitPrice: bigint
			tx: Record<string, bigint | number | string>
		}
	}) {
		this.processQueue = processQueue
		this.sweepOne = sweepOne
		this.buildFeeOverrides = buildFeeOverrides
	}

	processSweepQueue() {
		return this.processQueue()
	}

	sweepPayment(payment: PaymentLike) {
		return this.sweepOne(payment)
	}

	feeOverrides(feeData: FeeDataLike) {
		return this.buildFeeOverrides(feeData)
	}
}

export { ManualPaymentSweeper }
