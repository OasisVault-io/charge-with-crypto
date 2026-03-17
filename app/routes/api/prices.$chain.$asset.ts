import { apiError, json } from '../../lib/utils/api';
import { getAssetPrice } from '../../lib/services/configService';

export async function loader({ params }: { params: { chain?: string; asset?: string } }) {
  if (!params.chain || !params.asset) return apiError('route params missing', 400);
  try {
    return json(await getAssetPrice(params.chain, params.asset));
  } catch (err: any) {
    return apiError(err.message || 'invalid_request', err.statusCode || 400);
  }
}
