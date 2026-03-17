import { apiError, json } from '../../lib/utils/api'
import { createProductCheckout } from '../../lib/services/productService'

export async function action({
	request,
	params,
}: {
	request: Request
	params: { id?: string }
}) {
	if (request.method !== 'POST') return apiError('method_not_allowed', 405)
	try {
		return json(await createProductCheckout(request, params.id || ''), {
			status: 201,
		})
	} catch (err: any) {
		return apiError(err.message || 'invalid_request', err.statusCode || 400)
	}
}
