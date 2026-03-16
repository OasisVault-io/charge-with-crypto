import { apiError, json } from '../../lib/utils/api';
import { getProductDetail, updateProduct } from '../../lib/services/product.server';

export async function loader({ params }: { params: { id?: string } }) {
  try {
    return json(getProductDetail(params.id || ''));
  } catch (err: any) {
    return apiError(err.message || 'not_found', err.statusCode || 404);
  }
}

export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  if (request.method !== 'PATCH') return apiError('method_not_allowed', 405);
  try {
    return json(await updateProduct(request, params.id || ''));
  } catch (err: any) {
    return apiError(err.message || 'invalid_request', err.statusCode || 400);
  }
}
