import { apiError, json } from '../../lib/utils/api';
import { updateMerchant } from '../../lib/services/dashboard.server';

export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  const merchantId = params.id;
  if (request.method !== 'PATCH') return apiError('method_not_allowed', 405);
  if (!merchantId) return apiError('merchant not found', 404);

  try {
    return json(await updateMerchant(request, merchantId));
  } catch (err: any) {
    return apiError(err.message || 'invalid_request', err.statusCode || 400);
  }
}
