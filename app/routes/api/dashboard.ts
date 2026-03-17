import { getAppContext } from '../../lib/runtime'
import { json } from '../../lib/utils/api'

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url)
  const merchantId = String(
    url.searchParams.get('merchantId') || 'merchant_default',
  )
  return json(
    getAppContext().dashboardService.getDashboardData(request, merchantId),
  )
}
