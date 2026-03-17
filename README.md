# Charge With Crypto

A self-hosted crypto payment processor for business owners who want one sellable
to work for both humans and agents.

The canonical app runs on React Router v7, `viem`, Drizzle, Zod, and Tailwind
v4. The route tree and server-owned checkout logic live under `app/`, with React
Router loaders/actions calling directly into `app/lib/*`.

## How it works

1. Define merchant plans and stable products in Charge With Crypto.
2. Create a hosted checkout for a human or expose the same product over x402 for
   an agent.
3. Charge With Crypto verifies the payment on-chain.
4. Charge With Crypto records the payment and emits the same signed
   `payment.confirmed` webhook for either flow.
5. Your backend unlocks the product or service.

## Supported networks

| Network      | BTC | ETH | USDC | USDT |
| ------------ | --- | --- | ---- | ---- |
| Bitcoin      | ✓   | -   | -    | -    |
| Ethereum     | -   | ✓   | ✓    | ✓    |
| Base         | -   | ✓   | ✓    | ✓    |
| Arbitrum One | -   | ✓   | ✓    | ✓    |
| Polygon      | -   | ✓   | ✓    | ✓    |

## Quick start

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Open `http://localhost:3000`.

## Development

```bash
npm install
npm run dev
```

This runs the React Router v7 app on `http://127.0.0.1:4173`.

## Documentation

| Doc                                                            | Description                                    |
| -------------------------------------------------------------- | ---------------------------------------------- |
| [`docs/local-setup.md`](docs/local-setup.md)                   | prerequisites, env vars, and local development |
| [`docs/app-flow.md`](docs/app-flow.md)                         | end-to-end checkout lifecycle                  |
| [`docs/backend-integration.md`](docs/backend-integration.md)   | backend API and webhook contract               |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | code structure and migration boundaries        |
| [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) | launch and operations checklist                |

## Tech stack

- React Router v7
- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- `viem`
- Drizzle ORM
- `better-sqlite3`
- Zod
- QRCode + deterministic manual-pay derivation
- x402 + MCP support for agent payments and discovery

## Current structure

- `app/`: React Router v7 routes, route modules, server-side services, backend
  engine, and RR7-owned styling

## Scope

Included:

- hosted checkout
- dashboard
- stable product model on top of raw checkouts
- human hosted checkout from a product
- x402 agent access for the same product
- MCP server for product discovery and orchestration
- Bazaar metadata on x402 product routes
- EVM wallet pay
- Bitcoin checkout paths
- manual pay with deterministic deposit addresses
- signed webhooks
- merchant plan resolution via `POST /api/checkouts/resolve`

Not included:

- swaps
- subscriptions engine
- refunds
- multi-user merchant auth
- custody

## Main endpoints

- `POST /api/checkouts`
- `POST /api/checkouts/resolve`
- `GET /api/checkouts/:id`
- `POST /api/products`
- `GET /api/products`
- `POST /api/products/:id/checkouts`
- `POST /api/products/:id/access`
- `POST /api/x402/resolve`
- `POST /mcp`
