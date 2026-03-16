# Architecture

## Current ownership

The important boundary is:

- `app/` owns the React Router v7 route tree and canonical server-facing structure
- `src/` still owns most of the checkout engine, store, and blockchain services

## Main directories

### `app/`

- `app/routes/*`
  RR7 UI routes and resource routes
- `app/lib/services/*`
  server-side orchestration for checkout, dashboard, and config flows
- `app/lib/server/runtime.ts`
  bridge into the shared engine in `src/`
- `app/components/*`
  RR7 route components for the dashboard, checkout, and shared client helpers
- `app/app.css`
  Tailwind v4 theme layer and RR7 base tokens
- `app/styles/checkout-dashboard.css`
  checkout and dashboard styling used by the RR7 route components

### `src/`

- `src/appContext.ts`
  shared backend context creation
- `src/store/sqliteStore.ts`
  Drizzle-backed collection store over SQLite
- `src/db/*`
  Drizzle schema and database client setup
- `src/services/quoteService.ts`
  route quote creation and expiry
- `src/services/paymentService.ts`
  verification, payment records, and confirmation
- `src/services/productService.ts`
  stable sellables that can mint human checkouts or x402 agent access
- `src/services/x402Service.ts`
  Base USDC x402 seller flow, checkout-bound agent access, and Bazaar metadata
- `src/services/mcpService.ts`
  MCP server for product discovery and orchestration
- `src/services/manualPaymentService.ts`
  deterministic EVM manual-pay derivation, detection, and optional sweeping
- `src/services/bitcoinManualPaymentService.ts`
  Bitcoin manual-pay support
- `src/services/merchantWebhookService.ts`
  merchant checkout resolution
- `src/services/webhookService.ts`
  signed webhook delivery
- `src/services/evmVerifier.ts`
  EVM payment verification
- `src/services/bitcoinVerifier.ts`
  Bitcoin verification

## Request flow today

- `app/routes/*` renders the new route tree
- `app/routes/api/*` now serves the core API surface for the current checkout/dashboard flow
- `app/routes/api/products*`, `app/routes/api/x402*`, and `app/routes/mcp.ts` expose the business-owner sellable surfaces
- route loaders bootstrap dashboard and checkout state for native RR7 components

## Remaining consolidation

The frontend now runs only through the RR7 app. The remaining structural work is backend-oriented:

1. keep moving shared orchestration into `app/lib/services/*`
2. reduce `src/routes/api.ts` to a compatibility layer or retire it
3. keep `src/services/*` only as shared domain logic, or move those into `app/lib/*` as the migration finishes
