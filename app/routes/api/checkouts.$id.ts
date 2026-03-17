import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function loader({ params }: { params: { id?: string } }) {
	const id = params.id
	if (!id) return apiError('checkout not found', 404)
	try {
		return json(await getAppContext().checkoutService.getCheckoutBootstrap(id))
	} catch (error) {
		return apiErrorResponse(error, {
			defaultCode: 'checkout_not_found',
			defaultStatus: 404,
		})
	}
}
