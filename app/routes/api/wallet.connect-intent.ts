import { getAppContext } from '../../lib/runtime'
import { apiError, json } from '../../lib/utils/api'

export async function action({ request }: { request: Request }) {
	if (request.method !== 'POST') return apiError('method_not_allowed', 405)
	return json(await getAppContext().checkoutService.getWalletIntent(request))
}
