import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function action({
	request,
	params,
}: {
	request: Request
	params: { id?: string }
}) {
	if (request.method !== 'POST') return apiError('method_not_allowed', 405)
	const id = params.id
	if (!id) return apiError('checkout not found', 404)
	try {
		return json(
			await getAppContext().checkoutService.refreshCheckoutQuotes(request, id),
		)
	} catch (error) {
		return apiErrorResponse(error, {
			defaultCode: 'invalid_request',
			defaultStatus: 400,
		})
	}
}
