import { apiError, json } from '../../lib/utils/api'
import { scanCheckoutBalances } from '../../lib/services/checkoutService'

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
		return json(await scanCheckoutBalances(request, id))
	} catch (err: any) {
		return apiError(err.message || 'invalid_request', err.statusCode || 400)
	}
}
