# App Flow

## Sellables

There are two stable sellable layers:

1. plans on the merchant record
2. products in the `products` collection

Products sit above raw checkout creation. One product can be sold through:

- a hosted human checkout
- an x402 agent endpoint

Both flows end in the same payment confirmation path.

## Checkout creation

There are three main ways to create or resolve a payable session:

1. `POST /api/checkouts` Use this for direct admin usage.

2. `POST /api/checkouts/resolve` Use this for backend-driven merchant
   integrations.

3. `POST /api/products/:id/checkouts` Use this when you want a stable product to
   mint a human checkout.

`/api/checkouts/resolve` calls the merchant webhook with `checkout.resolve`,
receives the final checkout definition, then creates the hosted checkout.

## Hosted checkout

Each checkout stores:

- merchant branding and copy
- enabled chains
- accepted assets
- recipient settlement addresses by chain
- quotes for each supported `chain + asset` route

The hosted checkout UI then:

1. loads the checkout
2. loads active quotes
3. optionally scans wallet balances
4. recommends a payable route
5. submits the transaction hash for verification

## Agent access

For agents, the product surface is `POST /api/products/:id/access`.

When x402 is enabled:

1. the client makes an unpaid request
2. Charge With Crypto returns the x402 payment requirements
3. the agent pays over Base USDC
4. the same underlying sellable is marked paid
5. `payment.confirmed` is emitted with the matching `productId`, `quantity`,
   `purchaseId`, and `purchaseFlow`

There is also a checkout-scoped x402 route at `POST /api/x402/checkouts/:id`
when you want an agent to pay an already-created hosted checkout.

## Wallet pay

For EVM:

1. customer connects an injected wallet
2. the backend scans balances across enabled EVM routes
3. the UI recommends one route
4. the wallet sends the transaction to the merchant settlement address
5. Charge With Crypto verifies the transaction on-chain

For Bitcoin:

1. customer connects Xverse
2. the checkout uses the Bitcoin route only
3. Charge With Crypto verifies the Bitcoin transaction outputs

## Manual pay

If manual pay is enabled and configured:

1. Charge With Crypto assigns a deterministic deposit address to the checkout
2. the manual panel shows the address and QR code
3. the backend scans supported chains for matching deposits
4. once a qualifying transfer is confirmed, the checkout is marked paid

In xpub-only mode:

- the app derives addresses
- the app detects deposits
- sweeping happens outside the app

In legacy mnemonic mode:

- the app can also sweep deposits automatically if sponsor/signer config is
  present

## Payment confirmation

After successful verification:

1. a payment record is stored
2. the checkout is marked `paid`
3. a `payment.confirmed` event is created
4. webhook delivery is dispatched asynchronously so merchant latency does not
   block payment confirmation

## MCP

`POST /mcp` exposes tools for:

- listing products
- getting one product
- creating a hosted checkout for a human
- getting x402 access details for an agent

The MCP server is an orchestration surface, not a second payment engine. Actual
settlement still happens through hosted checkout or x402.

## UI ownership

The canonical route ownership is:

- `app/routes/*` owns the new React Router v7 route tree and resource routes
- `app/lib/*` owns the shared payment, product, x402, MCP, and persistence logic
  used by those routes
- `app/styles/*` contains the checkout and dashboard presentation layer used by
  the RR7 app
