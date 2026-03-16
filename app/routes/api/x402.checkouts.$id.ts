import { json } from '../../lib/utils/api';
import { checkoutX402 } from '../../lib/services/x402.server';

export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  try {
    const result = await checkoutX402(request, params.id || '');
    return json(result.body, { status: result.status, headers: result.headers });
  } catch (err: any) {
    return json({
      error: err.code || err.message || 'x402_error',
      message: err.message
    }, { status: err.statusCode || 500 });
  }
}
