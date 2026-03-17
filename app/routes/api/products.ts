import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function loader({ request }: { request: Request }) {
	return json(getAppContext().productService.listProducts(request))
}

export async function action({ request }: { request: Request }) {
	if (request.method !== 'POST') return apiError('method_not_allowed', 405)
	try {
		return json(await getAppContext().productService.createProduct(request), {
			status: 201,
		})
	} catch (error) {
		return apiErrorResponse(error, {
			defaultCode: 'invalid_request',
			defaultStatus: 400,
		})
	}
}
