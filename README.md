# Charge With Crypto

self hosted crypto checkout with a simpler review first ux.

## what changed in this pass
- checkout is now a single focused review screen with one recommended route and one primary pay button
- after wallet connect, the checkout scans balances across enabled evm chains and accepted assets on the backend, then auto-picks the cleanest payable route
- merchant settings now include branding, checkout copy, accepted assets, receiving addresses, manual pay chain toggles, and a logo upload path
- checkout creation supports `acceptedAssets` so merchants can default to `USDC` + `USDT` and exclude routes they do not want
- merchants can configure fixed plans in the dashboard, then resolve a checkout with only `referenceId` and `planId` via `POST /api/checkouts/resolve`
- the same merchant webhook now resolves a checkout first and later receives `payment.confirmed`
- manual pay now uses one deterministic derived EVM address per checkout, exposes a QR + address panel, verifies incoming stablecoin transfers onchain, and sweeps confirmed balances back to the merchant treasury
- stablecoin routes for `USDC` and `USDT` are pinned to `1 USD`, so those checkouts do not need quote refreshes

## scope and honesty
this is still a production leaning v1, not a full payments company in a box.

included:
- self hosted checkout + dashboard
- quote creation and refresh
- injected evm wallet pay flow
- wallet balance scan across enabled chains and accepted assets
- manual tx submission and verification
- webhook delivery with signed payloads
- sqlite local persistence
- deterministic manual payment address derivation, monitoring, and sweep orchestration for fixed stablecoin routes

not included:
- swaps, bridges, custody, subscriptions, refunds
- merchant auth and multi user roles
- dead letter queue
- non evm chains
- browser wallet support beyond injected evm providers

## run
```bash
cp .env.example .env
# fill in RPC_ETHEREUM, RPC_BASE, RPC_ARBITRUM, RPC_POLYGON
node src/server.js
```

open `http://localhost:3000`.

## local demo flow
1. create a checkout in the dashboard.
2. open the generated checkout link.
3. click `connect wallet` to scan supported chains and accepted assets, then let Charge With Crypto recommend the best route.
4. click `pay` to submit the onchain transaction from the injected wallet.
5. if needed, reveal `pay manually`, send the stablecoins to the unique deposit address shown in the qr panel.
6. Charge With Crypto monitors supported chains over rpc, marks the checkout paid after the transfer is confirmed, and emits a signed webhook.
7. the sweeper funds gas and forwards the manual deposit balance to the merchant treasury address on that chain.

## merchant address model
- `recipientAddresses`: the real merchant settlement addresses used for the primary connected wallet flow and final verification
- `manualPaymentEnabledChains`: which merchant-enabled networks may expose manual pay for a checkout
- `manualPayment.address`: the unique deterministic deposit address assigned to one checkout across supported EVM chains
- `manualPayment.derivationIndex`: the child index used to derive that checkout deposit address

manual pay is only exposed for fixed stablecoin routes on chains that the merchant enabled and the server can monitor.

## honesty about non custodial behavior
- connected wallet path stays non custodial. the server never holds customer signing authority.
- manual pay is operational treasury infrastructure. Charge With Crypto derives the deposit addresses and sweeps them, so the server must protect the manual payment mnemonic and sponsor key like real funds infrastructure.
- manual pay is therefore optional and chain-specific. if you cannot secure the sweep keys, do not enable it.

## env
- `RPC_ETHEREUM`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_POLYGON`: required for real verification on each chain
- `MIN_CONFIRMATIONS`: confirmation depth before marking paid
- `QUOTE_EXPIRY_SECONDS`: quote ttl
- `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_RETRIES`, `WEBHOOK_BACKOFF_MS`: webhook delivery controls
- `MANUAL_PAYMENT_MNEMONIC`: root phrase used to derive one EVM deposit address per checkout
- `MANUAL_PAYMENT_DERIVATION_PATH`: base derivation path, default `m/44'/60'/0'/0`
- `MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY`: funded EVM key that tops up gas for derived deposit wallets before sweeping tokens
- `MANUAL_PAYMENT_SCAN_INTERVAL_MS`, `MANUAL_PAYMENT_SCAN_BLOCK_WINDOW`: monitor loop controls

## api
- `GET /api/health`
- `GET /api/config`
- `GET /api/merchants`
- `POST /api/merchants`
- `PATCH /api/merchants/:id`
- `GET /api/dashboard?merchantId=merchant_default`
- `POST /api/checkouts`
- `POST /api/checkouts/resolve`
- `POST /api/checkouts/:id/balance-scan`
- `GET /api/checkouts/:id`
- `GET /api/checkouts/:id/status`
- `POST /api/checkouts/:id/quote`
- `POST /api/checkouts/:id/submit-tx`
- `GET /api/checkouts/:id/manual-payment`
- `POST /api/wallet/connect-intent`
- `GET /api/prices/:chain/:asset`

## merchant integration
- full merchant integration guide: [`docs/MERCHANT_INTEGRATION.md`](./docs/MERCHANT_INTEGRATION.md)
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
- checkout is marked paid only after the configured confirmation threshold is met

## test
```bash
node --test
```

## deployment notes
- this is fine for a single self hosted instance behind a reverse proxy
- use distinct rpc providers per chain and a strong webhook secret per merchant
- back up the sqlite file under `DATA_DIR` (default local path: `data/chaincart.sqlite`)
- fund the manual sweep sponsor wallet on every chain where manual pay is enabled
- protect the manual payment mnemonic and sponsor key like treasury secrets, because that is exactly what they are
