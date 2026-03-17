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
	try {
		return json(
			await getAppContext().productService.createProductCheckout(
				request,
				params.id || '',
			),
			{
			status: 201,
			},
		)
	} catch (error) {
		return apiErrorResponse(error, {
			defaultCode: 'invalid_request',
			defaultStatus: 400,
		})
	}
}
