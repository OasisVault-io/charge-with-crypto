import { getAppContext } from '../../lib/runtime'
import { apiErrorResponse, json } from '../../lib/utils/api'

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url)
  const merchantId = String(
    url.searchParams.get('merchantId') || 'merchant_default',
  )
  try {
    return json(
      await getAppContext().dashboardService.getDashboardData(
        request,
        merchantId,
      ),
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
