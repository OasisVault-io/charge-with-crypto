import { getAppContext } from '../server/runtime';
import { parseBody } from '../utils/api';

function nodeishRequest(request: Request) {
  const url = new URL(request.url);
  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(request.headers.entries())
  };
}

export async function resolveX402(request: Request) {
  const { x402Service } = getAppContext();
  const body = await parseBody<Record<string, any>>(request);
  return x402Service.handleResolveRequest(nodeishRequest(request), body);
}

export async function checkoutX402(request: Request, checkoutId: string) {
  const { x402Service } = getAppContext();
  const body = await parseBody<Record<string, any>>(request);
  return x402Service.handleCheckoutRequest(nodeishRequest(request), checkoutId, body);
}

export async function productAccessX402(request: Request, productId: string) {
  const { x402Service } = getAppContext();
  const body = await parseBody<Record<string, any>>(request);
  return x402Service.handleProductAccessRequest(nodeishRequest(request), productId, body);
}
