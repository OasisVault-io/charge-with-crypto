# Backend Integration

Use this guide for the real merchant integration path.

## Recommended flow

1. Configure merchant branding, recipient addresses, webhook URL, and webhook
   secret.
2. Store stable plan ids and product ids in Charge With Crypto.
3. Choose the payment surface:
   - human checkout via `POST /api/checkouts/resolve` or
     `POST /api/products/:id/checkouts`
   - agent access via `POST /api/products/:id/access`
4. Implement `checkout.resolve` if your backend defines checkout terms
   dynamically.
5. Handle `payment.confirmed` on the same webhook for both human and agent
   purchases.

## Product model

Use products when the same sellable should work for both humans and agents.

Important endpoints:

- `GET /api/products`
- `POST /api/products`
- `GET /api/products/:id`
- `PATCH /api/products/:id`
- `POST /api/products/:id/checkouts`
- `POST /api/products/:id/access`

The product record carries stable metadata such as title, description, amount,
merchant id, supported chains, and accepted assets.

## Main human endpoint

```http
POST /api/checkouts/resolve
Content-Type: application/json
```

Example:

```json
{
  "merchantId": "merchant_default",
  "referenceId": "sub_12345",
  "planId": "growth"
}
```

## Agent endpoint

```http
POST /api/products/:id/access
Content-Type: application/json
```

Example:

```json
{
  "referenceId": "svc_12345",
  "purchaseId": "purchase_01hrw8j5w4v8j1w7l5a1x8m2bt",
  "quantity": 2
}
```

Use a stable `referenceId` for your own customer or entitlement mapping, and a
unique `purchaseId` for each x402 purchase attempt. If x402 is enabled, this
route returns payment requirements to an unpaid agent request and settles the
same product through Base USDC.

## Merchant webhook events

Charge With Crypto uses the same merchant webhook for:

- `checkout.resolve`
- `payment.confirmed`

### `checkout.resolve`

Charge With Crypto sends:

```json
{
  "type": "checkout.resolve",
  "data": {
    "merchantId": "merchant_default",
    "referenceId": "sub_12345",
    "planId": "growth"
  }
}
```

Your webhook responds with the final checkout definition.

### `payment.confirmed`

Charge With Crypto sends:

```json
{
  "type": "payment.confirmed",
  "data": {
    "checkoutId": "checkouts_xxx",
    "referenceId": "sub_12345",
    "purchaseId": "purchase_01hrw8j5w4v8j1w7l5a1x8m2bt",
    "planId": "growth",
    "productId": "api-access",
    "quantity": 2,
    "purchaseFlow": "x402",
    "paymentId": "payments_xxx",
    "txHash": "0xabc...",
    "amountUsd": 49,
    "asset": "USDC",
    "chain": "base",
    "recipientAddress": "0x..."
  }
}
```

Your backend should verify the signature, reconcile the payment, and unlock the
product or service. `referenceId` is your stable reconciliation key;
`purchaseId` is the one-time agent purchase key that prevents free x402 replays.

The important point is that a hosted human checkout and an x402 agent purchase
converge on the same confirmation event shape.

## Signature model

- header: `x-charge-with-crypto-signature`
- timestamp header: `x-charge-with-crypto-timestamp`
- signing input: `${timestamp}.${raw_json_body}`
- algorithm: `HMAC-SHA256`

Always verify the raw request body, not a re-serialized JSON payload.

## Current core endpoints

- `GET /api/health`
- `GET /api/config`
- `GET /api/dashboard`
- `GET /api/merchants`
- `POST /api/merchants`
- `PATCH /api/merchants/:id`
- `POST /api/checkouts`
- `POST /api/checkouts/resolve`
- `GET /api/checkouts/:id`
- `GET /api/checkouts/:id/status`
- `POST /api/checkouts/:id/quote`
- `POST /api/checkouts/:id/balance-scan`
- `POST /api/checkouts/:id/submit-tx`
- `GET /api/checkouts/:id/manual-payment`
- `GET /api/products`
- `POST /api/products`
- `GET /api/products/:id`
- `PATCH /api/products/:id`
- `POST /api/products/:id/checkouts`
- `POST /api/products/:id/access`
- `POST /api/x402/resolve`
- `POST /api/wallet/connect-intent`
- `GET /api/prices/:chain/:asset`
- `GET /mcp`
- `POST /mcp`

## When to use direct checkout creation

Use `POST /api/checkouts` only when:

- you are testing locally
- you are running the public demo
- you are operating an authenticated admin flow

For real merchant traffic, prefer `POST /api/checkouts/resolve` or
product-backed checkout creation.

## MCP

`/mcp` is available for agent tooling that speaks the Model Context Protocol.

The current tools expose:

- `list_products`
- `get_product`
- `create_human_checkout`
- `get_agent_access`
