# Architecture

## Current ownership

The important boundary is:

- `app/` owns the React Router v7 route tree and canonical server-facing structure
- `app/lib/*` owns the checkout engine, store, and blockchain services used by those routes
- `src/` remains as a temporary compatibility surface while the last legacy callers are migrated

## Main directories

### `app/`

- `app/routes/*`
  RR7 UI routes and resource routes
- `app/lib/services/*Service.ts`
  route-facing orchestration where no same-name core service exists
- `app/lib/services/core/*`
  shared checkout, product, x402, MCP, payment, and webhook logic used by RR7 routes and services, including direct route-facing entrypoints where the facade was redundant
- `app/lib/runtime.ts`
  runtime singleton for app config and backend context
- `app/lib/store/*`
  persistence adapters
- `app/lib/db/*`
  Drizzle schema and database setup
- `app/lib/utils/*`
  shared backend validation, chain helpers, and HTTP utilities
- `app/components/*`
  RR7 route components for the dashboard, checkout, and shared client helpers
- `app/app.css`
  Tailwind v4 theme layer and RR7 base tokens
- `app/styles/checkout-dashboard.css`
  checkout and dashboard styling used by the RR7 route components

### `src/`

- legacy copies and compatibility entrypoints that still exist while remaining tests/scripts migrate

## Request flow today

- `app/routes/*` renders the route tree
- `app/routes/api/*` serves the checkout/dashboard/product/x402 API surface
- `app/lib/services/*Service.ts` and selected `app/lib/services/core/*Service.ts` files orchestrate route work using direct imports from `app/lib/store/*`, `app/lib/db/*`, and `app/lib/utils/*`
- route loaders bootstrap dashboard and checkout state for native RR7 components

## Remaining consolidation

The frontend now runs only through the RR7 app. The remaining structural work is mostly cleanup:

1. migrate any remaining legacy callers off `src/*`
2. retire `src/routes/api.ts` once no callers remain
3. delete the legacy `src/*` compatibility surface after the last consumers move
