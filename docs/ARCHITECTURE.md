# Charge With Crypto Architecture

## components
- `src/server.ts`: backend http server and api entrypoint. In production it serves the built Vite client from `dist/client`.
- `client/*.html` + `client/*.ts`: Vite multi-page frontend entries for home, checkout, and dashboard.
- `src/routes/api.ts`: checkout, merchant, and manual payment routes.
- `src/store/sqliteStore.ts`: sqlite persistence using `node:sqlite`.
- `src/services/quoteService.ts`: quote creation and expiry enforcement.
- `src/services/balanceService.ts`: rpc-backed wallet balance scanning across supported `chain + asset` routes.
- `src/services/provider.ts`: onchain provider interface and registry.
- `src/services/evmVerifier.ts`: evm rpc verification for native and erc20 transfers.
- `src/services/paymentService.ts`: payment confirmation and event creation.
- `src/services/manualPaymentService.ts`: deterministic manual deposit derivation, onchain transfer detection, and sweep orchestration.
- `src/services/merchantWebhookService.ts`: webhook based checkout resolution from a merchant reference id.
- `src/services/webhookService.ts`: signed webhook delivery and delivery logging.

## checkout architecture
1. checkout is created with merchant settlement addresses in `recipientByChain`.
2. if the merchant enabled manual pay and the server has the manual payment engine configured, Charge With Crypto derives one unique EVM deposit address for that checkout and stores it in `manualPayment`.
3. quote(s) are generated per enabled `chain + asset` route.
4. checkout ui renders a single review screen and keeps the settlement recipient hidden in the primary flow.
5. after wallet connect, the backend scans balances across enabled evm chains and accepted assets over rpc and recommends one payable route.
6. the main pay action submits the onchain transaction from the injected wallet to the settlement recipient.
7. manual pay is secondary only, hidden behind an explicit reveal, and shows the unique derived deposit address plus qr code for supported stablecoin routes.
8. the manual payment monitor scans ERC-20 `Transfer` logs to that address across enabled chains, confirms matching deposits, then marks the checkout `paid`.
9. successful verification marks checkout `paid`, stores a payment record, emits `payment.confirmed`, and attempts webhook delivery.
10. the sweeper funds gas to the derived deposit wallet when needed and transfers the token balance to the merchant treasury address on that chain.
11. if a merchant uses `POST /api/checkouts/resolve`, Charge With Crypto first calls the merchant webhook with a signed `checkout.resolve` event including optional `planId` and turns the response into a checkout session.
12. stablecoin quotes for `USDC` and `USDT` are fixed at `1 USD`, so those routes do not expire and do not need customer-facing refresh controls.

## manual payment model
- merchant responsibility: choose which chains expose manual pay and keep the treasury settlement addresses current.
- server responsibility: protect the manual payment mnemonic and sweep sponsor private key.
- Charge With Crypto responsibility: derive one unique deposit address per checkout, expose it in the secondary manual panel, detect matching deposits onchain, and sweep confirmed balances to treasury.
- current allocation rule: next unused derivation index under the configured HD path.
- current release rule: none. derived addresses are treated as single use identifiers in v1.

## security notes
- connected wallet path remains non custodial. Charge With Crypto does not sign for the customer.
- manual pay is treasury infrastructure. whoever operates the server must secure the mnemonic and sponsor key.
- webhook signature header: `x-charge-with-crypto-signature`.
- signature input: `${timestamp}.${raw_json_body}`.

## data model additions
### merchant
- `manualPaymentEnabledChains: string[]`
- `defaultAcceptedAssets: string[]`
- `brandName`, `logoUrl`, `checkoutHeadline`, `checkoutDescription`
- `plans: Array<{ id, title, amountUsd, description, enabledChains, acceptedAssets }>`

### checkout
- `acceptedAssets: string[]`
- `planId?: string`
- `manualPayment: { available, status, derivationIndex, address, enabledChains, acceptedAssets, scanState, sweepStatus }`

## explicit tradeoffs
- this keeps the primary wallet flow non custodial for the customer, but manual pay is not keyless.
- this handles deterministic derivation and sweeping for EVM stablecoins only.
- manual pay is intentionally limited to fixed stablecoin routes because volatile asset quotes do not fit an address-and-qr fallback well.
- sweep reliability still depends on a funded sponsor wallet and healthy chain RPC access.
