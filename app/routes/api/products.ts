import { apiError, json } from '../../lib/utils/api';
import { createProduct, listProducts } from '../../lib/services/product.server';

export async function loader({ request }: { request: Request }) {
  return json(listProducts(request));
}

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') return apiError('method_not_allowed', 405);
  try {
    return json(await createProduct(request), { status: 201 });
  } catch (err: any) {
    return apiError(err.message || 'invalid_request', err.statusCode || 400);
  }
}
