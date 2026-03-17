import { getAppContext } from '../../lib/runtime'
import { json, x402ErrorResponse } from '../../lib/utils/api'

export async function action({
	request,
	params,
}: {
	request: Request
	params: { id?: string }
}) {
	try {
		const result = await getAppContext().x402Service.checkoutRequest(
			request,
			params.id || '',
		)
		return json(result.body, { status: result.status, headers: result.headers })
	} catch (error) {
		return x402ErrorResponse(error)
	}
}
