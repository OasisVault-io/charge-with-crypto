import { apiError, json } from '../../lib/utils/api'
import { getManualPaymentDetails } from '../../lib/services/checkoutService'

export async function loader({ params }: { params: { id?: string } }) {
	const id = params.id
	if (!id) return apiError('checkout not found', 404)
	try {
		return json(await getManualPaymentDetails(id))
	} catch (err: any) {
		return apiError(err.message || 'checkout not found', err.statusCode || 404)
	}
}
