# Charge With Crypto

self hosted crypto checkout with a simpler review first ux.

## what changed in this pass
- checkout is now a single focused review screen with one recommended route and one primary pay button
- after wallet connect, the checkout scans balances across enabled evm chains and accepted assets on the backend, then auto-picks the cleanest payable route
- merchant settings now include branding, checkout copy, accepted assets, receiving addresses, manual pay chain toggles, and a logo upload path
- checkout creation supports `acceptedAssets` so merchants can default to `USDC` + `USDT` and exclude routes they do not want
- merchants can configure fixed plans in the dashboard, then resolve a checkout with only `referenceId` and `planId` via `POST /api/checkouts/resolve`
- the same merchant webhook now resolves a checkout first and later receives `payment.confirmed`
- the same merchant product can now be sold to agents over `x402` on Base USDC via `POST /api/x402/resolve`
- merchant products now have stable public endpoints for humans and agents: `POST /api/products/:id/checkouts` and `POST /api/products/:id/access`
- Bazaar discovery metadata is attached to product x402 routes, and a lightweight MCP server is available at `GET/POST /mcp`
- manual pay now uses one deterministic derived EVM address per checkout, exposes a QR + address panel, verifies incoming stablecoin transfers onchain, and can either sweep automatically or be swept later outside the app
- stablecoin routes for `USDC` and `USDT` are pinned to `1 USD`, so those checkouts do not need quote refreshes

## scope and honesty
this is still a production leaning v1, not a full payments company in a box.

included:
- self hosted checkout + dashboard
- quote creation and refresh
- injected evm wallet pay flow
- bitcoin checkout routes
- wallet balance scan across enabled chains and accepted assets
- manual tx submission and verification
- webhook delivery with signed payloads
- `x402` agent payments on Base USDC with Coinbase facilitator support
- sqlite local persistence
- deterministic manual payment address derivation, monitoring, and optional sweep orchestration for fixed stablecoin routes

not included:
- swaps, bridges, custody, subscriptions, refunds
- merchant auth and multi user roles
- dead letter queue
- browser wallet support beyond injected evm providers

## run
```bash
cp .env.example .env
# fill in RPC_ETHEREUM, RPC_BASE, RPC_ARBITRUM, RPC_POLYGON
npm install
npm run build
npm start
```

open `http://localhost:3000`.

## development
```bash
npm install
npm run dev
```

- vite serves the frontend on `http://127.0.0.1:5173`
- the api server runs from `src/server.ts` on the configured backend port

## deployment modes
- `APP_MODE=demo`: keeps public checkout creation available for demo merchants and is what you should use for a public sandbox.
- `APP_MODE=production`: disables unauthenticated `POST /api/checkouts`, requires a non-default `DASHBOARD_TOKEN`, and expects merchant integrations to create sessions through `POST /api/checkouts/resolve`.
- the intended setup is one secure codebase with two deployments: a public demo in `demo` mode and merchant/self-hosted integrations in `production` mode.

## local demo flow
1. create a checkout in the dashboard.
2. open the generated checkout link.
3. click `connect wallet` to scan supported chains and accepted assets, then let Charge With Crypto recommend the best route.
4. click `pay` to submit the onchain transaction from the injected wallet.
5. if needed, reveal `pay manually`, send the stablecoins to the unique deposit address shown in the qr panel.
6. Charge With Crypto monitors supported chains over rpc, marks the checkout paid after the transfer is confirmed, and emits a signed webhook.
7. if local or external sweeping is configured, the detected manual deposit can then be forwarded to the merchant treasury address on that chain.

## merchant address model
- `recipientAddresses`: the real merchant settlement addresses used for the primary connected wallet flow and final verification
- `manualPaymentEnabledChains`: which merchant-enabled networks may expose manual pay for a checkout
- `manualPayment.address`: the unique deterministic deposit address assigned to one checkout across supported EVM chains
- `manualPayment.derivationIndex`: the child index used to derive that checkout deposit address

manual pay is only exposed for fixed stablecoin routes on chains that the merchant enabled and the server can monitor.

## honesty about non custodial behavior
- connected wallet path stays non custodial. the server never holds customer signing authority.
- manual pay can run in two EVM modes: `xpub` derivation with manual or external sweeping, or legacy mnemonic-based derivation with local sweeping.
- bitcoin manual address derivation already uses `bitcoinXpub`; it does not require a mnemonic in the app.

## env
- `APP_MODE`: `demo` or `production`. Defaults to `production` only when `NODE_ENV=production`, otherwise `demo`
- `RPC_ETHEREUM`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_POLYGON`: required for real verification on each chain
- `MIN_CONFIRMATIONS`: confirmation depth before marking paid
- `QUOTE_EXPIRY_SECONDS`: quote ttl
- `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_RETRIES`, `WEBHOOK_BACKOFF_MS`: webhook delivery controls
- `DASHBOARD_TOKEN`: required in `APP_MODE=production`
- `MANUAL_PAYMENT_XPUB`: preferred EVM public derivation key for one deposit address per checkout without storing the seed phrase in-app
- `MANUAL_PAYMENT_MNEMONIC`: legacy EVM root phrase if you want local derivation plus optional local sweep signing
- `MANUAL_PAYMENT_DERIVATION_PATH`: base derivation path, default `m/44'/60'/0'/0`
- `MANUAL_PAYMENT_SWEEP_SIGNER_URL`: optional external sweep service for xpub-derived wallets
- `MANUAL_PAYMENT_SWEEP_SIGNER_SECRET`: optional bearer token for the external sweep service
- `MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY`: funded EVM key that tops up gas for derived deposit wallets before sweeping tokens in legacy local sweep mode
- `MANUAL_PAYMENT_SCAN_INTERVAL_MS`, `MANUAL_PAYMENT_SCAN_BLOCK_WINDOW`: monitor loop controls
- `X402_ENABLED`: enable agent payments over `x402`
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`: required for Coinbase facilitator verify + settle in production
- `X402_FACILITATOR_URL`: optional custom facilitator override
- `X402_BASE_NETWORK`, `X402_BASE_ASSET`: defaults are `eip155:8453` and `USDC`

## api
- `GET /api/health`
- `GET /api/config`
- `GET /api/merchants`
- `POST /api/merchants`
- `PATCH /api/merchants/:id`
- `GET /api/products`
- `POST /api/products`
- `GET /api/products/:id`
- `PATCH /api/products/:id`
- `POST /api/products/:id/checkouts`
- `POST /api/products/:id/access`
- `GET /api/dashboard?merchantId=merchant_default`
- `POST /api/checkouts`
- `POST /api/checkouts/resolve`
- `POST /api/x402/resolve`
- `POST /api/x402/checkouts/:id`
- `POST /api/checkouts/:id/balance-scan`
- `GET /api/checkouts/:id`
- `GET /api/checkouts/:id/status`
- `POST /api/checkouts/:id/quote`
- `POST /api/checkouts/:id/submit-tx`
- `GET /api/checkouts/:id/manual-payment`
- `POST /api/wallet/connect-intent`
- `GET /api/prices/:chain/:asset`
- `GET /mcp`
- `POST /mcp`

`POST /api/checkouts` is for demo/admin flows. Real merchant integrations should use `POST /api/checkouts/resolve` from their backend.

## x402 agent flow
- use the same merchant `planId` and `referenceId` contract as the hosted checkout flow
- agents call `POST /api/x402/resolve` with `merchantId`, `referenceId`, and optional `planId`
- Charge With Crypto resolves the sale from the same merchant webhook used by `POST /api/checkouts/resolve`
- if unpaid, the route responds with `402` plus `PAYMENT-REQUIRED`
- if paid, Charge With Crypto settles through the facilitator, creates an internal paid checkout record, and emits the same `payment.confirmed` webhook the human flow uses
- demo and QA flows can also point an agent at `POST /api/x402/checkouts/:id` so the same checkout record can be paid either by the hosted UI or by an agent
- product-specific integrations can point agents at `POST /api/products/:id/access`, which adds Bazaar discovery metadata to the `402` response and creates the same paid checkout record a human flow would use
- first cut is intentionally narrow: Base + USDC only

## product endpoints
- `POST /api/products` creates a stable merchant product record that can be used by both human and agent flows
- `POST /api/products/:id/checkouts` creates a hosted checkout for a product, with optional `referenceId` and `quantity`
- `POST /api/products/:id/access` exposes the same product over `x402` and settles into the same `payment.confirmed` flow
- checkouts created from products store `productId` and `quantity`, so fulfillment can reconcile one sellable across both surfaces

## mcp
- `GET /mcp` returns endpoint metadata for remote MCP clients
- `POST /mcp` implements a lightweight streamable HTTP MCP server
- current tools: `list_products`, `get_product`, `create_human_checkout`, `get_agent_access`
- the MCP layer is for discovery and orchestration; the paid agent path still settles through the product x402 endpoint

`POST /api/checkouts` is for demo/admin flows. Real merchant integrations should use `POST /api/checkouts/resolve` from their backend.

## merchant integration
- full merchant integration guide: [`docs/MERCHANT_INTEGRATION.md`](./docs/MERCHANT_INTEGRATION.md)
- production launch checklist: [`docs/PRODUCTION_CHECKLIST.md`](./docs/PRODUCTION_CHECKLIST.md)
- typical flow:
  1. configure merchant branding, plans, recipient addresses, `webhookUrl`, and `webhookSecret`
  2. your backend calls `POST /api/checkouts/resolve` with `merchantId`, `referenceId`, and optional `planId`
  3. Charge With Crypto calls your webhook with `checkout.resolve`
  4. your webhook returns the checkout details to create
  5. Charge With Crypto returns the hosted checkout url
  6. customer pays
  7. Charge With Crypto verifies onchain and sends `payment.confirmed` to the same webhook

## verification rules
- native payments: tx `to` must match the merchant settlement recipient and `value >= quoted amount`
- erc20 payments: receipt must contain a transfer log to the merchant settlement recipient from the configured token contract with `amount >= quoted amount`
- quote refresh and verification work per `chain + asset` route, not just per chain
- `USDC` and `USDT` are treated as fixed peg assets at `1 USD`, so their quotes do not expire and the checkout hides refresh controls for all-stable sessions
- manual pay confirms ERC-20 transfers by scanning `Transfer` logs to the unique derived deposit address across the merchant enabled chains
- in xpub-only mode, detected deposits are marked `manual_required` for sweeping and the merchant can move funds later outside this app
- checkout is marked paid only after the configured confirmation threshold is met

## test
```bash
npm test
```

## deployment notes
- this is fine for a single self hosted instance behind a reverse proxy
- set `APP_MODE=production` for real merchant traffic and keep public demos on a separate `demo` deployment
- use distinct rpc providers per chain and a strong webhook secret per merchant
- back up the sqlite file under `DATA_DIR` (default local path: `data/chaincart.sqlite`)
- if you use local automatic sweeping, fund the manual sweep sponsor wallet on every chain where manual pay is enabled
- if you use xpub-only mode, the app never needs the EVM seed phrase, but you must operate your sweep flow elsewhere
