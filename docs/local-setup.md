# Local Setup

## Prerequisites

- Node.js 22+
- npm
- RPC endpoints for any EVM chains you want to verify locally
- SQLite is embedded locally through `better-sqlite3`

## Install

```bash
npm install
cp .env.example .env
```

Fill in the relevant env vars in `.env`.

Minimum useful local config:

- `RPC_ETHEREUM`
- `RPC_BASE`
- `RPC_ARBITRUM`
- `RPC_POLYGON`
- `DASHBOARD_TOKEN` if you want the canonical authenticated dashboard behavior

Optional x402 / agent config:

- `X402_ENABLED=true`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `X402_FACILITATOR_URL` if you are not using the Coinbase-managed default

Optional manual-pay config:

- `MANUAL_PAYMENT_XPUB`
- `MANUAL_PAYMENT_MNEMONIC`
- `MANUAL_PAYMENT_DERIVATION_PATH`
- `MANUAL_PAYMENT_SWEEP_SIGNER_URL`
- `MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY`

## Run the app

```bash
npm run dev
```

This starts the React Router v7 app on `http://127.0.0.1:4173`.

The RR7 app owns the checkout, dashboard, products, x402, MCP, and core API route modules.

## Build

Production build:

```bash
npm run build
```

The production server is started with:

```bash
npm start
```

## Typecheck and tests

```bash
npm run typecheck
npm run typecheck:rr7
npm test
```
