import { apiError, json } from '../../lib/utils/api';
import { createDirectCheckout } from '../../lib/services/checkout.server';

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') return apiError('method_not_allowed', 405);
  try {
    return json(await createDirectCheckout(request), { status: 201 });
  } catch (err: any) {
    if (err.body) return json(err.body, { status: err.statusCode || 400 });
    return apiError(err.message || 'invalid_request', err.statusCode || 400);
  }
}
