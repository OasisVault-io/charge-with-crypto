# Open Source Crypto Checkout

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React Router](https://img.shields.io/badge/React_Router-CA4245?style=flat&logo=react-router&logoColor=white)](https://reactrouter.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A simple, zero-fee crypto payment processor you can run yourself.

Accept payments directly to your wallet, without intermediaries, approvals, or
extra fees. Supports both human checkouts and agent-based payments via x402.

Test it, fork it, customize it, and deploy your own version in less than a day.

The canonical app runs on React Router v7, `viem`, Drizzle, Zod, and Tailwind
v4. The route tree and server-owned checkout logic live under `app/`, with React
Router loaders/actions calling directly into `app/lib/*`.

> **Note:** This was built in roughly a week. If you fork it for production use, we strongly recommend reviewing the code and tailoring it to your setup.

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

## Prerequisites

- Node.js (v18 or higher)
- npm or pnpm

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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
