// @ts-nocheck
const { nowIso } = require('../utils/time');
const { deliverWebhook } = require('./webhookService');
const { normalizeChainTxHash } = require('../utils/validation');

function paymentMatchesChainTxHash(payment, chain, txHash) {
  return payment.chain === chain && String(payment.txHash || '').toLowerCase() === txHash;
}

function conflictingPaymentForTx({ store, checkoutId, chain, txHash }) {
  return store.findOne('payments', (payment) =>
    payment.checkoutId !== checkoutId &&
    paymentMatchesChainTxHash(payment, chain, txHash)
  );
}

function existingPaymentForCheckoutTx({ store, checkoutId, chain, txHash }) {
  return store.findOne('payments', (payment) =>
    payment.checkoutId === checkoutId &&
    paymentMatchesChainTxHash(payment, chain, txHash)
  );
}

async function emitPaymentConfirmed({ store, config, checkout, quote, payment, chain }) {
  const recipientAddress = checkout.recipientByChain?.[chain] || checkout.recipientAddress;
  const event = store.insert('events', {
    merchantId: checkout.merchantId,
    checkoutId: checkout.id,
    paymentId: payment.id,
    type: 'payment.confirmed',
    data: {
      checkoutId: checkout.id,
      productId: checkout.productId || null,
      referenceId: checkout.referenceId || null,
      planId: checkout.planId || null,
      quantity: Number(checkout.quantity || 1),
      purchaseFlow: checkout.purchaseFlow || 'hosted_checkout',
      title: checkout.title || checkout.orderId,
      description: checkout.description || '',
      merchantId: checkout.merchantId,
      merchantName: checkout.merchantName,
      orderId: checkout.orderId,
      paymentId: payment.id,
      txHash: payment.txHash,
      amount: quote.cryptoAmount,
      amountBaseUnits: quote.cryptoAmountBaseUnits,
      amountUsd: checkout.amountUsd,
      asset: quote.asset,
      chain: quote.chain,
      recipientAddress
    }
  });

  const merchant = store.getById('merchants', checkout.merchantId);
  if (merchant) await deliverWebhook({ store, config, merchant, event });
}

async function confirmCheckoutIfNeeded({ store, config, checkout, quote, payment, chain }) {
  if (checkout.status === 'paid') return store.getById('checkouts', checkout.id) || checkout;
  store.update('checkouts', checkout.id, {
    status: 'paid',
    paidAt: nowIso(),
    paymentId: payment.id,
    paidChain: quote.chain,
    paidAsset: quote.asset,
    recipientAddress: payment.recipientAddress
  });
  await emitPaymentConfirmed({ store, config, checkout, quote, payment, chain: chain || quote.chain });
  return store.getById('checkouts', checkout.id) || checkout;
}

async function verifyQuotePayment({ providers, quote, recipientAddress, txHash, walletAddress }) {
  const provider = providers.get(quote.chain);
  return provider.verifyPayment({
    txHash,
    walletAddress,
    expectedAmount: quote.cryptoAmount,
    expectedAmountBaseUnits: quote.cryptoAmountBaseUnits,
    expectedAsset: quote.asset,
    expectedChain: quote.chain,
    recipientAddress
  });
}

async function verifyPaymentAndRecord({ store, providers, config, checkout, quote, chain, txHash, walletAddress }) {
  const txChain = quote?.chain || chain;
  let normalizedTxHash;
  try {
    normalizedTxHash = normalizeChainTxHash(txHash, txChain);
  } catch (err) {
    err.statusCode = 400;
    throw err;
  }
  const conflicting = conflictingPaymentForTx({
    store,
    checkoutId: checkout.id,
    chain: txChain,
    txHash: normalizedTxHash
  });
  if (conflicting) {
    const err = new Error('tx hash already linked to another checkout');
    err.statusCode = 409;
    throw err;
  }

  const existing = existingPaymentForCheckoutTx({
    store,
    checkoutId: checkout.id,
    chain: txChain,
    txHash: normalizedTxHash
  });
  if (existing) {
    if (existing.status === 'confirmed') return { payment: existing, verification: existing.verification, duplicate: true };

    const existingQuote = store.getById('quotes', existing.quoteId) || quote;
    const existingRecipient = existing.recipientAddress
      || checkout.recipientByChain?.[existingQuote.chain]
      || checkout.recipientByChain?.[chain]
      || checkout.recipientAddress;
    const verification = await verifyQuotePayment({
      providers,
      quote: existingQuote,
      recipientAddress: existingRecipient,
      txHash: normalizedTxHash,
      walletAddress: walletAddress || existing.walletAddress
    });

    const updated = store.update('payments', existing.id, {
      status: verification.ok ? 'confirmed' : 'pending',
      verification,
      walletAddress: walletAddress || existing.walletAddress || null
    });

    if (verification.ok) {
      await confirmCheckoutIfNeeded({ store, config, checkout, quote: existingQuote, payment: updated, chain: existingQuote.chain });
    }

    return { payment: updated, verification, duplicate: true };
  }

  const recipientAddress = checkout.recipientByChain?.[quote.chain] || checkout.recipientByChain?.[chain] || checkout.recipientAddress;
  const verification = await verifyQuotePayment({ providers, quote, recipientAddress, txHash: normalizedTxHash, walletAddress });

  const payment = store.insert('payments', {
    checkoutId: checkout.id,
    quoteId: quote.id,
    txHash: normalizedTxHash,
    walletAddress: walletAddress || null,
    method: 'onchain',
    chain: quote.chain,
    asset: quote.asset,
    recipientAddress,
    status: verification.ok ? 'confirmed' : 'pending',
    verification
  });

  if (verification.ok) await confirmCheckoutIfNeeded({ store, config, checkout, quote, payment, chain: quote.chain });

  return { payment, verification };
}

async function reconcilePendingCheckoutPayments({ store, providers, config, checkout }) {
  if (!checkout || checkout.status === 'paid') return checkout;

  const pendingPayments = store.find('payments', (payment) =>
    payment.checkoutId === checkout.id &&
    payment.method === 'onchain' &&
    payment.status !== 'confirmed' &&
    Boolean(payment.txHash)
  );

  let latestCheckout = checkout;
  for (const payment of pendingPayments) {
    const quote = store.getById('quotes', payment.quoteId);
    if (!quote) continue;

    const recipientAddress = payment.recipientAddress
      || checkout.recipientByChain?.[quote.chain]
      || checkout.recipientByChain?.[checkout.defaultChain]
      || checkout.recipientAddress;

    let verification;
    try {
      verification = await verifyQuotePayment({
        providers,
        quote,
        recipientAddress,
        txHash: payment.txHash,
        walletAddress: payment.walletAddress || undefined
      });
    } catch (err) {
      verification = { ok: false, reason: 'provider_error', message: err.message };
    }

    const updated = store.update('payments', payment.id, {
      status: verification.ok ? 'confirmed' : 'pending',
      verification
    });

    if (verification.ok) {
      latestCheckout = await confirmCheckoutIfNeeded({ store, config, checkout: latestCheckout, quote, payment: updated, chain: quote.chain });
      break;
    }
  }

  return store.getById('checkouts', checkout.id) || latestCheckout;
}

async function recordManualDetectedPayment({
  store,
  config,
  checkout,
  quote,
  txHash,
  walletAddress,
  recipientAddress,
  observedAmountBaseUnits,
  tokenAddress,
  blockNumber,
  confirmations
}) {
  const normalizedTxHash = normalizeChainTxHash(txHash, quote.chain);
  const conflicting = conflictingPaymentForTx({
    store,
    checkoutId: checkout.id,
    chain: quote.chain,
    txHash: normalizedTxHash
  });
  if (conflicting) throw new Error('tx hash already linked to another checkout');

  const existing = existingPaymentForCheckoutTx({
    store,
    checkoutId: checkout.id,
    chain: quote.chain,
    txHash: normalizedTxHash
  });
  const verification = {
    ok: true,
    manual: true,
    detection: 'deposit_address',
    confirmations: Number(confirmations || 0),
    observedAmountBaseUnits: String(observedAmountBaseUnits || ''),
    expectedAmountBaseUnits: quote.cryptoAmountBaseUnits,
    recipientAddress,
    tokenAddress: tokenAddress || null,
    senderAddress: walletAddress || null,
    blockNumber: Number(blockNumber || 0),
    reason: 'confirmed'
  };

  if (existing) {
    const updated = store.update('payments', existing.id, {
      walletAddress: walletAddress || existing.walletAddress || null,
      recipientAddress,
      chain: quote.chain,
      asset: quote.asset,
      status: 'confirmed',
      verification
    });
    await confirmCheckoutIfNeeded({ store, config, checkout, quote, payment: updated, chain: quote.chain });
    return updated;
  }

  const payment = store.insert('payments', {
    checkoutId: checkout.id,
    quoteId: quote.id,
    txHash: normalizedTxHash,
    walletAddress: walletAddress || null,
    method: 'manual',
    chain: quote.chain,
    asset: quote.asset,
    recipientAddress,
    status: 'confirmed',
    verification
  });

  store.update('checkouts', checkout.id, { manualPaid: true });
  await confirmCheckoutIfNeeded({ store, config, checkout, quote, payment, chain: quote.chain });
  return payment;
}

async function recordConfirmedExternalPayment({
  store,
  config,
  checkout,
  quote,
  txHash,
  walletAddress,
  recipientAddress,
  method = 'external',
  verification = {}
}) {
  const normalizedTxHash = normalizeChainTxHash(txHash, quote.chain);
  const conflicting = conflictingPaymentForTx({
    store,
    checkoutId: checkout.id,
    chain: quote.chain,
    txHash: normalizedTxHash
  });
  if (conflicting) throw new Error('tx hash already linked to another checkout');

  const existing = existingPaymentForCheckoutTx({
    store,
    checkoutId: checkout.id,
    chain: quote.chain,
    txHash: normalizedTxHash
  });
  const mergedVerification = {
    ok: true,
    reason: 'confirmed',
    ...verification,
    recipientAddress,
    senderAddress: walletAddress || verification.senderAddress || null
  };

  if (existing) {
    const updated = store.update('payments', existing.id, {
      walletAddress: walletAddress || existing.walletAddress || null,
      recipientAddress,
      chain: quote.chain,
      asset: quote.asset,
      method,
      status: 'confirmed',
      verification: mergedVerification
    });
    await confirmCheckoutIfNeeded({ store, config, checkout, quote, payment: updated, chain: quote.chain });
    return updated;
  }

  const payment = store.insert('payments', {
    checkoutId: checkout.id,
    quoteId: quote.id,
    txHash: normalizedTxHash,
    walletAddress: walletAddress || null,
    method,
    chain: quote.chain,
    asset: quote.asset,
    recipientAddress,
    status: 'confirmed',
    verification: mergedVerification
  });

  await confirmCheckoutIfNeeded({ store, config, checkout, quote, payment, chain: quote.chain });
  return payment;
}

module.exports = {
  verifyPaymentAndRecord,
  reconcilePendingCheckoutPayments,
  recordManualDetectedPayment,
  recordConfirmedExternalPayment
};

export { verifyPaymentAndRecord, reconcilePendingCheckoutPayments, recordManualDetectedPayment, recordConfirmedExternalPayment };
