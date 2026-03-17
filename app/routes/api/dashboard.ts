import { json } from '../../lib/utils/api';
import { getDashboardData } from '../../lib/services/dashboardService';

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const merchantId = String(url.searchParams.get('merchantId') || 'merchant_default');
  return json(getDashboardData(request, merchantId));
}
