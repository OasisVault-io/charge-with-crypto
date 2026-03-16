import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('dashboard', 'routes/dashboard.tsx'),
  route('checkout/:id', 'routes/checkout.$id.tsx'),
  route('mcp', 'routes/mcp.ts'),
  route('api/health', 'routes/api/health.ts'),
  route('api/config', 'routes/api/config.ts'),
  route('api/dashboard', 'routes/api/dashboard.ts'),
  route('api/merchants', 'routes/api/merchants.ts'),
  route('api/merchants/:id', 'routes/api/merchants.$id.ts'),
  route('api/products', 'routes/api/products.ts'),
  route('api/products/:id', 'routes/api/products.$id.ts'),
  route('api/products/:id/checkouts', 'routes/api/products.$id.checkouts.ts'),
  route('api/products/:id/access', 'routes/api/products.$id.access.ts'),
  route('api/checkouts', 'routes/api/checkouts.ts'),
  route('api/checkouts/resolve', 'routes/api/checkouts.resolve.ts'),
  route('api/x402/resolve', 'routes/api/x402.resolve.ts'),
  route('api/x402/checkouts/:id', 'routes/api/x402.checkouts.$id.ts'),
  route('api/checkouts/:id', 'routes/api/checkouts.$id.ts'),
  route('api/checkouts/:id/status', 'routes/api/checkouts.$id.status.ts'),
  route('api/checkouts/:id/quote', 'routes/api/checkouts.$id.quote.ts'),
  route('api/checkouts/:id/balance-scan', 'routes/api/checkouts.$id.balance-scan.ts'),
  route('api/checkouts/:id/submit-tx', 'routes/api/checkouts.$id.submit-tx.ts'),
  route('api/checkouts/:id/manual-payment', 'routes/api/checkouts.$id.manual-payment.ts'),
  route('api/wallet/connect-intent', 'routes/api/wallet.connect-intent.ts'),
  route('api/prices/:chain/:asset', 'routes/api/prices.$chain.$asset.ts')
] satisfies RouteConfig;
