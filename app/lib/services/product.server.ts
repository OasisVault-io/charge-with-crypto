import { getAppContext, getConfig, legacyApi, productService } from '../server/runtime';
import { parseBody } from '../utils/api';

export function listProducts(request: Request) {
  const { store } = getAppContext();
  const config = getConfig();
  const url = new URL(request.url);
  const merchantId = String(url.searchParams.get('merchantId') || '').trim();
  return {
    products: store.list('products')
      .filter((product: any) => (merchantId ? product.merchantId === merchantId : true))
      .filter((product: any) => product.active !== false)
      .map((product: any) => productService.publicProduct(product, config))
  };
}

export async function createProduct(request: Request) {
  const config = getConfig();
  const { store } = getAppContext();
  legacyApi.requireDashboardAuth({
    headers: Object.fromEntries(request.headers.entries())
  }, config);

  const body = await parseBody<Record<string, any>>(request);
  const payload = legacyApi.normalizeProductPayload({ body, store, config });
  const id = productService.normalizeProductId(body.id || body.slug || `product_${Math.random().toString(36).slice(2, 10)}`);
  if (!id) {
    const err: any = new Error('id is required');
    err.statusCode = 400;
    throw err;
  }
  if (store.getById('products', id)) {
    const err: any = new Error('product already exists');
    err.statusCode = 409;
    throw err;
  }
  const product = store.insert('products', { id, ...payload });
  return { product: productService.publicProduct(product, config) };
}

export function getProductDetail(productId: string) {
  const config = getConfig();
  const { store, x402Service } = getAppContext();
  const product = productService.requireProduct(store, productId);
  const merchant = productService.resolveProductMerchant({ store, product });
  return {
    product: productService.publicProduct(product, config),
    merchant: {
      id: merchant.id,
      name: merchant.brandName || merchant.name,
      supportEmail: merchant.supportEmail || ''
    },
    x402: x402Service?.status?.() || { enabled: false },
    mcp: {
      endpoint: `${config.baseUrl}/mcp`,
      tools: ['list_products', 'get_product', 'create_human_checkout', 'get_agent_access']
    }
  };
}

export async function updateProduct(request: Request, productId: string) {
  const config = getConfig();
  const { store } = getAppContext();
  legacyApi.requireDashboardAuth({
    headers: Object.fromEntries(request.headers.entries())
  }, config);
  const existing = productService.requireProduct(store, productId);
  const body = await parseBody<Record<string, any>>(request);
  const payload = legacyApi.normalizeProductPayload({ body, existing, store, config });
  const updated = store.update('products', existing.id, payload);
  return { product: productService.publicProduct(updated, config) };
}

export async function createProductCheckout(request: Request, productId: string) {
  const config = getConfig();
  const context = getAppContext();
  const product = productService.requireProduct(context.store, productId);
  const merchant = productService.resolveProductMerchant({ store: context.store, product });
  const body = await parseBody<Record<string, any>>(request);
  const checkoutBody = productService.buildProductCheckoutInput({ product, merchant, body });
  const created = await legacyApi.createCheckoutResponse({
    store: context.store,
    config,
    priceService: context.priceService,
    manualPaymentService: context.manualPaymentService,
    bitcoinAddressService: context.bitcoinAddressService,
    body: checkoutBody
  });
  return {
    ...created.body,
    product: productService.publicProduct(product, config),
    endpoints: productService.productEndpoints({ product, config })
  };
}
