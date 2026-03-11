# Merchant Integration

This is the contract your product team integrates against.

The intended merchant flow is:

1. Merchant configures plans, recipient addresses, webhook URL, and webhook secret in the dashboard.
2. Your backend tells Charge With Crypto which internal order or subscription is being purchased.
3. Charge With Crypto calls your webhook to resolve that request into a real checkout.
4. Charge With Crypto returns the hosted checkout URL.
5. Customer pays.
6. Charge With Crypto verifies the payment onchain.
7. Charge With Crypto sends `payment.confirmed` to the same merchant webhook.

## Merchant Setup

Before integration, configure:

- `webhookUrl`
- `webhookSecret`
- branding
- recipient addresses per chain
- plans such as `starter`, `growth`, `scale`

Recommended plan model:

- stable `planId`
- display `title`
- `amountUsd`
- `acceptedAssets`
- `enabledChains`

## Main Merchant Flow

Your backend should call:

```http
POST /api/checkouts/resolve
Content-Type: application/json
```

Example request:

```json
{
  "merchantId": "merchant_default",
  "referenceId": "sub_12345",
  "planId": "growth"
}
```

Meaning:

- `merchantId`: which merchant config to use
- `referenceId`: your internal id for the order, subscription, invoice, or session
- `planId`: optional stored plan id if you already know the plan

If the request succeeds, Charge With Crypto returns a created checkout and `checkoutUrl`.

## Webhook 1: checkout.resolve

When Charge With Crypto receives `POST /api/checkouts/resolve`, it calls your merchant webhook first.

Headers:

- `x-charge-with-crypto-event: checkout.resolve`
- `x-charge-with-crypto-timestamp: <unix seconds>`
- `x-charge-with-crypto-signature: t=<timestamp>,v1=<hmac>`

Payload:

```json
{
  "type": "checkout.resolve",
  "createdAt": "2026-03-10T00:00:00.000Z",
  "data": {
    "merchantId": "merchant_default",
    "referenceId": "sub_12345",
    "planId": "growth"
  }
}
```

Your webhook should respond with either:

```json
{
  "checkout": {
    "planId": "growth",
    "orderId": "sub_12345",
    "title": "Growth",
    "description": "Default plan for most customers.",
    "amountUsd": 49,
    "acceptedAssets": ["USDC", "USDT"],
    "enabledChains": ["base", "arbitrum", "polygon"],
    "successUrl": "https://merchant.app/billing/success",
    "cancelUrl": "https://merchant.app/billing/cancel"
  }
}
```

or the same object at top level:

```json
{
  "planId": "growth",
  "orderId": "sub_12345",
  "title": "Growth",
  "description": "Default plan for most customers.",
  "amountUsd": 49,
  "acceptedAssets": ["USDC", "USDT"],
  "enabledChains": ["base", "arbitrum", "polygon"]
}
```

What your backend should do:

1. Verify Charge With Crypto signature.
2. Read `referenceId` and `planId`.
3. Look up the order or subscription in your system.
4. Return the exact checkout details Charge With Crypto should create.

## Webhook 2: payment.confirmed

After successful onchain verification, Charge With Crypto sends a second webhook to the same endpoint.

Headers:

- `x-charge-with-crypto-event: payment.confirmed`
- `x-charge-with-crypto-timestamp: <unix seconds>`
- `x-charge-with-crypto-signature: t=<timestamp>,v1=<hmac>`

Payload:

```json
{
  "id": "events_xxx",
  "type": "payment.confirmed",
  "createdAt": "2026-03-10T00:00:00.000Z",
  "data": {
    "checkoutId": "checkouts_xxx",
    "referenceId": "sub_12345",
    "planId": "growth",
    "title": "Growth",
    "description": "Default plan for most customers.",
    "merchantId": "merchant_default",
    "merchantName": "OasisVault",
    "orderId": "sub_12345",
    "paymentId": "payments_xxx",
    "txHash": "0xabc...",
    "amount": "49",
    "amountBaseUnits": "49000000",
    "amountUsd": 49,
    "asset": "USDC",
    "chain": "base",
    "recipientAddress": "0x..."
  }
}
```

What your backend should do:

1. Verify Charge With Crypto signature.
2. Check `referenceId` or `checkoutId`.
3. Mark the corresponding order or subscription as paid.
4. Unlock the product or service.
5. Return `2xx`.

## Signature Verification

Signature scheme:

- header format: `x-charge-with-crypto-signature: t=<timestamp>,v1=<hmac>`
- signing input: `${timestamp}.${raw_request_body}`
- algorithm: `HMAC-SHA256`
- secret: merchant `webhookSecret`

Important:

- use the raw request body, not a re-serialized JSON object
- reject requests with stale timestamps
- use constant-time comparison for the HMAC

Pseudo-code:

```txt
timestamp = header timestamp
signed_payload = timestamp + "." + raw_body
expected = HMAC_SHA256(webhook_secret, signed_payload)
compare expected to v1 from header
```

## What Your Dev Needs To Build

Minimum integration:

1. Store a `referenceId` for the thing being sold.
2. Create or map a stable `planId`.
3. Add one backend endpoint for Charge With Crypto webhooks.
4. Handle two event types:
   - `checkout.resolve`
   - `payment.confirmed`
5. Have your app call `POST /api/checkouts/resolve`.

Typical server flow:

1. Customer clicks buy in your app.
2. Your backend knows they want `planId = growth`.
3. Your backend calls Charge With Crypto:

```json
{
  "merchantId": "merchant_default",
  "referenceId": "sub_12345",
  "planId": "growth"
}
```

4. Charge With Crypto calls your webhook with `checkout.resolve`.
5. Your webhook replies with the actual checkout definition.
6. Charge With Crypto returns `checkoutUrl`.
7. Your frontend redirects customer to `checkoutUrl`.
8. Charge With Crypto later sends `payment.confirmed`.
9. Your backend marks access active.

## How To Test It Actually Works

Use this sequence. Do not skip signature validation.

### Test 1: Webhook resolve only

Goal:

- prove your webhook can resolve a checkout correctly

Steps:

1. Configure merchant `webhookUrl` and `webhookSecret`.
2. In your backend, implement `checkout.resolve`.
3. Call:

```http
POST /api/checkouts/resolve
Content-Type: application/json
```

```json
{
  "merchantId": "merchant_default",
  "referenceId": "test_resolve_001",
  "planId": "growth"
}
```

Expected result:

- your webhook receives `checkout.resolve`
- it returns checkout data
- Charge With Crypto responds with a valid `checkoutUrl`
- the checkout page shows the right plan title, amount, assets, and chains

### Test 2: Payment confirmation end to end

Goal:

- prove onchain payment creates the merchant-side paid state

Steps:

1. Use the resolve flow above to create a checkout.
2. Open the checkout URL.
3. Connect a wallet with enough balance on one supported chain.
4. Pay the checkout.
5. Wait for Charge With Crypto to verify the transaction.

Expected result:

- checkout moves to success state
- your webhook receives `payment.confirmed`
- your backend marks the matching `referenceId` as paid

Verify fields:

- `referenceId`
- `planId`
- `txHash`
- `amountUsd`
- `asset`
- `chain`
- `recipientAddress`

### Test 3: Signature validation

Goal:

- prove you are not accepting forged webhooks

Steps:

1. Temporarily log the raw body, timestamp, and received signature in a dev environment.
2. Recompute the HMAC locally.
3. Confirm it matches exactly.
4. Send a modified body with the same signature.

Expected result:

- original request passes
- modified request fails

### Test 4: Fulfillment idempotency

Goal:

- make sure duplicate deliveries do not double-activate access

Steps:

1. Re-send the same `payment.confirmed` payload to your backend.
2. Keep the same `checkoutId`, `paymentId`, and `referenceId`.

Expected result:

- your backend treats it as already processed
- no duplicate subscription, invoice, or entitlement is created

## Recommended Merchant Data Model

Keep at least:

- `referenceId`
- `planId`
- `checkoutId`
- `paymentId`
- `txHash`
- `status`
- `amountUsd`
- `asset`
- `chain`

## Production Notes

- use separate high-quality RPC providers per chain
- use a unique strong webhook secret per merchant
- keep webhook handling idempotent
- treat `payment.confirmed` as the source of truth for fulfillment
- do not fulfill on `checkout.resolve`

## Current Readiness

Ready now:

- plan-based resolve flow
- one webhook for both event types
- signed webhook delivery
- onchain verification for EVM native and ERC-20 transfers
- hosted checkout flow

Still needs hardening:

- persistent production storage should move off instance-local SQLite
- webhook replay protection is partly up to the merchant receiver and should be enforced there too
