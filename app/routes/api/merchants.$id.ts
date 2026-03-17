import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function action({
  request,
  params,
}: {
  request: Request
  params: { id?: string }
}) {
  const merchantId = params.id
  if (request.method !== 'PATCH') return apiError('method_not_allowed', 405)
  if (!merchantId) return apiError('merchant not found', 404)

  try {
    return json(
      await getAppContext().dashboardService.updateMerchant(
        request,
        merchantId,
      ),
    )
  } catch (error) {
    return apiErrorResponse(error, {
      defaultCode: 'invalid_request',
      defaultStatus: 400,
    })
  }
}
