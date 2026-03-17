import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function loader() {
  return json(getAppContext().dashboardService.listMerchants())
}

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') return apiError('method_not_allowed', 405)
  try {
    return json(
      await getAppContext().dashboardService.createMerchant(request),
      { status: 201 },
    )
  } catch (error) {
    return apiErrorResponse(error, {
      defaultCode: 'invalid_request',
      defaultStatus: 400,
    })
  }
}
