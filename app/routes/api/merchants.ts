import { apiError, json } from '../../lib/utils/api';
import { createMerchant, listMerchants } from '../../lib/services/dashboardService';

export async function loader() {
  return json(listMerchants());
}

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') return apiError('method_not_allowed', 405);
  try {
    return json(await createMerchant(request), { status: 201 });
  } catch (err: any) {
    return apiError(err.message || 'invalid_request', err.statusCode || 400);
  }
}
