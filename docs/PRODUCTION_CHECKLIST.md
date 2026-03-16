# Production Checklist

Use this when you are integrating Charge With Crypto into a real merchant flow.

## Required

- Set `APP_MODE=production`.
- Set `DASHBOARD_TOKEN` to a strong non-default value. Startup should fail if you do not.
- Configure real RPC endpoints for every enabled chain.
- Set a unique `WEBHOOK_SECRET` or merchant-specific `webhookSecret`.
- If you enable agent payments, set `X402_ENABLED=true` and configure real facilitator credentials.
- If you use legacy local EVM sweeping, protect `MANUAL_PAYMENT_MNEMONIC` and `MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY` like treasury secrets.
- If you use xpub-only EVM derivation, treat `MANUAL_PAYMENT_XPUB` as public infrastructure data and secure only your external/manual sweep keys outside this app.

## Integration

- Call `POST /api/checkouts/resolve` from your backend.
- Use products when the same sellable should be available over hosted checkout and x402.
- Do not expose public `POST /api/checkouts` for real merchant traffic.
- Verify `checkout.resolve` and `payment.confirmed` webhook signatures using the raw request body.
- Keep your own stable `referenceId` or `planId` mapping so you can reconcile `payment.confirmed`.
- Require a unique `purchaseId` for every x402 agent purchase attempt.
- If you expose agent access, verify your `productId` and `quantity` mapping on `payment.confirmed`.
- Require customers to submit the wallet address they paid from for EVM `submit-tx` flows.

## Demo Separation

- Run any public sandbox or marketing demo with `APP_MODE=demo`.
- Restrict demo mode to demo merchants only.
- Do not reuse demo merchant ids, recipient addresses, or webhook endpoints for real orders.

## Operations

- Monitor webhook delivery failures and onchain verification errors.
- Back up the SQLite database under `DATA_DIR`.
- Fund the manual sweep sponsor wallet on every chain where manual pay is enabled only if you use local in-app sweeping.
- Review enabled chains, accepted assets, and settlement addresses before going live.
