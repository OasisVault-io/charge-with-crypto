import { apiError, json } from '../../lib/utils/api'
import { getWalletIntent } from '../../lib/services/checkoutService'

export async function action({ request }: { request: Request }) {
	if (request.method !== 'POST') return apiError('method_not_allowed', 405)
	return json(getWalletIntent(request))
}
