// @ts-nocheck
const checkoutId = new URLSearchParams(window.location.search).get('id');
const preferredChainOrder = ['bitcoin', 'base', 'arbitrum', 'polygon', 'ethereum'];
const preferredAssetOrder = ['BTC', 'USDC', 'USDT', 'ETH'];
const statusPollDelayMs = 3000;
const defaultMerchantLogo = '/charge-with-crypto-mark.svg';
const checkoutTemplateParam = new URLSearchParams(window.location.search).get('template');
const dueAmountFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let state = null;
let walletSession = null;
let currentWalletAddress = null;
let walletConnected = false;
let checkoutReady = false;
let statusPollTimer = null;
let paymentWindowTimer = null;
let manualPanelOpen = false;
let manualDetailsLoaded = false;
let manualSelectedRouteKey = '';

function quoteKey(quote) {
  return `${quote.chain}:${quote.asset}`;
}

function quoteExpiresAtMs(quote) {
  if (!quote?.expiresAt) return null;
  const value = new Date(quote.expiresAt).getTime();
  return Number.isFinite(value) ? value : null;
}

function quoteExpiredLocally(quote, now = Date.now()) {
  const expiresAt = quoteExpiresAtMs(quote);
  return expiresAt != null && expiresAt <= now;
}

function activeStateQuotes(now = Date.now()) {
  return (state?.quotes || []).filter((quote) => !quoteExpiredLocally(quote, now));
}

function pendingOnchainPayment() {
  return (state?.payments || []).find((payment) => payment.method === 'onchain' && payment.status !== 'confirmed' && payment.txHash) || null;
}

function paymentWindowExpired(now = Date.now()) {
  if (state?.checkout?.status === 'paid' || pendingOnchainPayment()) return false;
  const expiringQuotes = (state?.quotes || []).filter((quote) => quoteExpiresAtMs(quote) != null);
  if (!expiringQuotes.length) return false;
  return expiringQuotes.every((quote) => quoteExpiredLocally(quote, now));
}

function paymentWindowRemainingMs(now = Date.now()) {
  const expiries = activeStateQuotes(now)
    .map((quote) => quoteExpiresAtMs(quote))
    .filter((value) => value != null);
  if (!expiries.length) return null;
  return Math.max(0, Math.min(...expiries) - now);
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function chainHex(chainId) {
  return `0x${Number(chainId).toString(16)}`;
}

function explorerTx(chain, txHash) {
  const base = {
    bitcoin: 'https://mempool.space/tx/',
    ethereum: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    polygon: 'https://polygonscan.com/tx/'
  }[chain];
  return base ? `${base}${txHash}` : txHash;
}

function chainLabel(chain) {
  return state?.config?.chains?.[chain]?.name || chain;
}

function shortAddress(address) {
  if (!address) return '';
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatUsdAmount(amount) {
  return dueAmountFormatter.format(Number(amount || 0));
}

function applyDueAmountSizing(node, amountText) {
  if (!node?.classList) return;
  const digitCount = String(amountText || '').replace(/\D/g, '').length;
  node.classList.remove('hero-amount-tight', 'hero-amount-compact', 'hero-amount-ultra');
  if (digitCount >= 10) node.classList.add('hero-amount-ultra');
  else if (digitCount >= 8) node.classList.add('hero-amount-compact');
  else if (digitCount >= 6) node.classList.add('hero-amount-tight');
}

function safeLogoSrc(src) {
  return src || defaultMerchantLogo;
}

function bootstrapStorageKey() {
  return checkoutId ? `checkout-bootstrap:${checkoutId}` : '';
}

function readCheckoutBootstrap() {
  const key = bootstrapStorageKey();
  if (!key) return null;
  try {
    const raw = window.sessionStorage?.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    const payload = JSON.parse(raw);
    return payload?.checkout?.id === checkoutId ? payload : null;
  } catch (_err) {
    return null;
  }
}

function attachLogoFallback(image) {
  if (!image) return;
  image.onerror = () => {
    image.onerror = null;
    image.src = defaultMerchantLogo;
  };
}

function logoMarkup({ className, src, alt }) {
  return `<img class="${className}" data-merchant-logo src="${safeLogoSrc(src)}" alt="${alt}" />`;
}

function hydrateLogoImages() {
  if (!document.querySelectorAll) return;
  document.querySelectorAll('[data-merchant-logo]').forEach((image) => attachLogoFallback(image));
}

function merchantDisplayName(checkout) {
  const raw = checkout?.merchantBrandName || checkout?.merchantName || checkout?.merchantId || 'merchant';
  if (/^merchant_default$/i.test(String(raw))) return 'OasisVault';
  return String(raw).replace(/^merchant[_-]?/i, '').replace(/[_-]+/g, ' ').trim() || 'merchant';
}

function merchantHeroParts(checkout) {
  const merchantName = merchantDisplayName(checkout).replace(/\s+checkout$/i, '').trim();
  const camelSplit = merchantName.replace(/([a-z])([A-Z])/g, '$1 $2');
  const words = camelSplit.split(/\s+/).filter(Boolean);
  if (!words.length) return { lead: 'WITH MERCHANT', trail: 'PAYMENT' };
  if (words.length === 1) return { lead: `WITH ${words[0].toUpperCase()}`, trail: 'PAYMENT' };
  return {
    lead: `WITH ${words[0].toUpperCase()}`,
    trail: words.slice(1).join(' ').toUpperCase()
  };
}

function checkoutTemplate(checkout) {
  const candidate = (checkoutTemplateParam || checkout?.checkoutTemplate || '').toLowerCase();
  return candidate === 'oasis' ? 'oasis' : 'neutral';
}

function applyCheckoutTemplate(checkout) {
  const template = checkoutTemplate(checkout);
  if (!document.body?.classList) return;
  document.body.classList.toggle('checkout-template-oasis', template === 'oasis');
  document.body.classList.toggle('checkout-template-neutral', template === 'neutral');
}

function walletRail() {
  return walletSession?.rail || '';
}

function walletProviderId() {
  return walletSession?.provider || '';
}

function walletCompatibleQuote(quote) {
  if (!walletSession) return false;
  return walletRail() === 'bitcoin' ? quote.chain === 'bitcoin' : quote.chain !== 'bitcoin';
}

function walletCompatibleQuotes() {
  return activeStateQuotes().filter((quote) => walletCompatibleQuote(quote));
}

function balanceForQuote(quote) {
  return state?.balances?.[quoteKey(quote)] || null;
}

function isQuotePayable(quote) {
  const balance = balanceForQuote(quote);
  return Boolean(balance && balance.raw != null && BigInt(balance.raw) >= BigInt(quote.cryptoAmountBaseUnits));
}

function routeScore(quote) {
  const assetIndex = preferredAssetOrder.indexOf(quote.asset);
  const chainIndex = preferredChainOrder.indexOf(quote.chain);
  return ((assetIndex === -1 ? 99 : assetIndex) * 10) + (chainIndex === -1 ? 99 : chainIndex);
}

function recommendedQuote() {
  if (!walletConnected) return null;
  const compatible = walletCompatibleQuotes();
  if (!compatible.length) return null;
  const payable = compatible.filter((quote) => isQuotePayable(quote));
  const ranked = payable.length ? payable : compatible;
  return [...ranked].sort((a, b) => routeScore(a) - routeScore(b))[0] || null;
}

function manualPaymentAvailable() {
  return Boolean(state?.checkout?.manualPayment?.available);
}

function refreshNeeded() {
  const fixedAssets = new Set(state?.config?.fixedPriceAssets || []);
  const assets = state?.checkout?.acceptedAssets || [];
  return assets.some((asset) => !fixedAssets.has(asset));
}

function manualRoutes() {
  return state?.manualDetails?.routes || state?.checkout?.manualPayment?.routes || [];
}

function selectedManualRoute() {
  const routes = manualRoutes();
  if (!routes.length) return null;
  return routes.find((route) => route.key === manualSelectedRouteKey)
    || routes.find((route) => route.key === state?.manualDetails?.preferredRouteKey)
    || routes[0];
}

function checkoutPaymentRail() {
  const explicit = state?.checkout?.paymentRail;
  if (explicit === 'bitcoin' || explicit === 'evm') return explicit;
  const quotes = state?.quotes || [];
  const hasBitcoin = quotes.some((quote) => quote.chain === 'bitcoin');
  const hasEvm = quotes.some((quote) => quote.chain !== 'bitcoin');
  return hasBitcoin && !hasEvm ? 'bitcoin' : 'evm';
}

function preConnectWalletCopy() {
  const providerCount = availableWalletProviders().length;
  if (!providerCount) return 'No compatible wallet options are configured for this checkout.';
  if (checkoutPaymentRail() === 'bitcoin') return 'Connect Xverse or pay manually to send BTC.';
  return 'Connect a wallet to review the best route for this payment.';
}

function walletDisplayLabel() {
  const labels = {
    'injected-evm': 'Injected EVM wallet',
    xverse: 'Xverse'
  };
  return labels[walletProviderId()] || 'Connected wallet';
}

function walletSupportsPayAction(quote) {
  if (!walletSession || !quote) return false;
  return walletCompatibleQuote(quote);
}

function availableWalletProviders() {
  const providers = [];
  const quotes = activeStateQuotes();
  const hasBitcoin = quotes.some((quote) => quote.chain === 'bitcoin' && quote.asset === 'BTC');
  const hasEvm = quotes.some((quote) => quote.chain !== 'bitcoin');

  if (checkoutPaymentRail() === 'evm' && hasEvm) {
    providers.push({ id: 'injected-evm', label: 'Injected EVM', rail: 'evm' });
  }
  if (checkoutPaymentRail() === 'bitcoin' && hasBitcoin) {
    providers.push({ id: 'xverse', label: 'Xverse BTC', rail: 'bitcoin' });
  }
  return providers;
}

function defaultWalletProviderId() {
  return availableWalletProviders()[0]?.id || '';
}

function vendors() {
  return window.ChargeWithCryptoVendors || {};
}

function xverseAddressItems(response) {
  if (Array.isArray(response?.result?.addresses)) return response.result.addresses;
  if (Array.isArray(response?.result)) return response.result;
  if (Array.isArray(response)) return response;
  return [];
}

function renderHero(checkout) {
  applyCheckoutTemplate(checkout);
  const merchantName = merchantDisplayName(checkout);
  const brandHeroLead = document.getElementById('brandHeroLead');
  const brandHeroTrail = document.getElementById('brandHeroTrail');
  const heroParts = merchantHeroParts(checkout);
  if (brandHeroLead) brandHeroLead.textContent = heroParts.lead;
  if (brandHeroTrail) {
    brandHeroTrail.textContent = heroParts.trail;
    brandHeroTrail.hidden = !heroParts.trail;
  }
  document.title = `${merchantName} Checkout`;
  document.getElementById('checkoutHeadline').textContent = checkout.title || 'Review and pay';
  document.getElementById('checkoutSubheadline').textContent = checkout.description || 'Connect a wallet and Charge With Crypto will recommend the cleanest way to pay.';
  const dueAmount = document.getElementById('dueAmount');
  const formattedAmount = formatUsdAmount(checkout.amountUsd);
  dueAmount.textContent = formattedAmount;
  dueAmount.title = formattedAmount;
  applyDueAmountSizing(dueAmount, formattedAmount);
  document.getElementById('acceptedAssetPills').innerHTML = (checkout.acceptedAssets || [checkout.asset]).map((asset) => `<span class="asset-pill">${asset}</span>`).join('');
}

function renderSummary(checkout) {
  const merchantName = merchantDisplayName(checkout);
  document.getElementById('summary').innerHTML = `
    <div class="summary-brand">
      ${logoMarkup({ className: 'summary-logo', src: checkout.merchantLogoUrl, alt: `${merchantName} logo` })}
      <div class="summary-brand-copy">
        <div class="eyebrow">Merchant</div>
        <div class="summary-brand-row">
          <strong class="summary-brand-name">${merchantName}</strong>
          <div class="muted small-copy summary-brand-description">${checkout.description || 'Wallet-first crypto checkout'}</div>
        </div>
      </div>
    </div>
  `;
  hydrateLogoImages();
}

function renderWalletProviderButtons() {
  const node = document.getElementById('walletProviderButtons');
  if (!node) return;
  const providers = availableWalletProviders();
  node.hidden = walletConnected || !providers.length || state?.checkout?.status === 'paid' || (checkoutPaymentRail() !== 'bitcoin' && providers.length <= 1);
  if (node.hidden) {
    node.innerHTML = '';
    return;
  }
  node.innerHTML = providers.map((provider) =>
    `<button type="button" class="secondary-button wallet-provider-button" data-wallet-provider="${provider.id}">${provider.label}</button>`
  ).join('');
  node.querySelectorAll?.('[data-wallet-provider]').forEach((button) => {
    button.addEventListener('click', () => detectBalances(button.dataset.walletProvider).catch(alert));
  });
}

function renderWalletMeta() {
  const node = document.getElementById('walletMeta');
  const hero = document.getElementById('walletHero');
  const connectBtn = document.getElementById('connectWalletBtn');
  const heading = document.getElementById('walletHeading');
  const stepLabel = document.getElementById('walletStepLabel');
  if (!node) return;
  if (hero) hero.hidden = Boolean(manualPanelOpen && state?.checkout?.status !== 'paid');
  renderWalletProviderButtons();

  if (!walletConnected || !currentWalletAddress) {
    const remaining = paymentWindowRemainingMs();
    node.textContent = paymentWindowExpired()
      ? 'Payment window expired. Refresh prices to continue.'
      : remaining != null
        ? `${preConnectWalletCopy()} Payment window ${formatCountdown(remaining)}.`
        : preConnectWalletCopy();
    hero?.classList.remove('wallet-connected');
    hero?.classList.remove('wallet-stage-compact');
    if (heading) {
      heading.textContent = 'Connect a wallet';
      heading.hidden = false;
    }
    if (stepLabel) stepLabel.hidden = false;
    if (connectBtn) {
      connectBtn.hidden = paymentWindowExpired() || checkoutPaymentRail() === 'bitcoin';
      connectBtn.textContent = 'Connect wallet';
    }
    return;
  }

  const scannedChains = [...new Set(walletCompatibleQuotes().map((quote) => chainLabel(quote.chain)))].join(', ');
  const remaining = paymentWindowRemainingMs();
  node.innerHTML = `
    <span class="wallet-copy-line">
      Connected ${walletDisplayLabel()} <span class="code wallet-chip">${shortAddress(currentWalletAddress)}</span>
    </span>
    <span class="wallet-scan-line muted">${walletRail() === 'bitcoin' ? 'Bitcoin rail' : 'EVM rail'}${scannedChains ? ` · Scanned ${scannedChains}` : ''}${remaining != null ? ` · Window ${formatCountdown(remaining)}` : ''}.</span>
  `;
  hero?.classList.add('wallet-connected');
  hero?.classList.add('wallet-stage-compact');
  if (heading) heading.hidden = true;
  if (stepLabel) stepLabel.hidden = true;
  if (connectBtn) connectBtn.hidden = true;
}

function renderRecommendation() {
  const panel = document.getElementById('routePanel');
  const node = document.getElementById('recommendation');
  if (!walletConnected || manualPanelOpen) {
    panel.hidden = true;
    node.innerHTML = '';
    return;
  }

  const quote = recommendedQuote();
  panel.hidden = false;
  if (!quote) {
    node.innerHTML = `<span class="badge warn">Route unavailable</span><p class="muted">No compatible payable route was found for the connected wallet.</p>`;
    return;
  }

  const payable = isQuotePayable(quote);
  node.innerHTML = `
    <div class="route-heading">
      <div>
        <span class="eyebrow">Step 2</span>
        <h2>Best payment route</h2>
      </div>
      <span class="badge ${payable ? 'ok' : 'warn'}">${payable ? 'Ready to pay' : 'Balance too low'}</span>
    </div>
    <p class="muted">Charge With Crypto scans the connected wallet and focuses the checkout on one route that matches the selected rail.</p>
  `;
}

function renderQuoteOptions() {
  const panel = document.getElementById('routePanel');
  const node = document.getElementById('quoteOptions');
  if (!walletConnected || manualPanelOpen) {
    panel.hidden = true;
    node.innerHTML = '';
    return;
  }

  const quote = recommendedQuote();
  if (!quote) {
    panel.hidden = false;
    node.innerHTML = `<div class="route-card"><span class="badge warn">Route unavailable</span><span class="muted">No compatible route was found for the connected wallet.</span></div>`;
    return;
  }

  const balance = balanceForQuote(quote);
  const payable = isQuotePayable(quote);
  const reason = payable
    ? `Detected balance makes ${chainLabel(quote.chain)} the cleanest route right now.`
    : `This is the cleanest route for the connected wallet, but the balance is still below the exact amount due.`;
  const balanceText = balance?.display ? `${balance.display} ${quote.asset}` : (balance?.error || 'Unavailable');

  node.innerHTML = `
    <div class="route-card recommended-route-card">
      <div class="route-card-main">
        <div class="route-topline">
          <strong>${chainLabel(quote.chain)}</strong>
          <span class="asset-tag">${quote.asset}</span>
        </div>
        <div class="route-amount">${quote.cryptoAmount} ${quote.asset}</div>
        <p class="muted">${reason}</p>
      </div>
      <div class="route-side">
        <span class="eyebrow">Wallet balance</span>
        <strong class="balance-value">${balanceText}</strong>
        <span class="badge ${payable ? 'ok' : 'warn'}">${payable ? 'Payable now' : 'Needs more balance'}</span>
      </div>
    </div>
  `;
}

function renderStatus(checkout, payments) {
  const node = document.getElementById('status');
  if (!node || !checkout) return;
  const pending = pendingOnchainPayment();
  const last = (payments || [])[0];

  if (checkout.status === 'paid') {
    const paidPayment = (payments || []).find((payment) => payment.status === 'confirmed') || last;
    let html = '<div class="status-card"><span class="badge ok">Payment confirmed</span><div class="status-copy">Payment was confirmed onchain.</div>';
    if (paidPayment?.txHash) {
      html += `<a href="${explorerTx(paidPayment.chain || checkout.paidChain || checkout.defaultChain, paidPayment.txHash)}" target="_blank">View transaction</a>`;
    }
    html += '</div>';
    node.hidden = false;
    node.innerHTML = html;
    return;
  }

  if (pending) {
    let html = `<div class="status-card"><span class="badge warn">Payment submitted</span><div class="status-copy">Confirming on ${chainLabel(pending.chain || checkout.defaultChain)}.</div>`;
    if (pending.txHash) html += `<a href="${explorerTx(pending.chain || checkout.defaultChain, pending.txHash)}" target="_blank">View transaction</a>`;
    html += '</div>';
    node.hidden = false;
    node.innerHTML = html;
    return;
  }

  if (paymentWindowExpired()) {
    const expiredCopy = checkoutPaymentRail() === 'bitcoin'
      ? 'Broadcast the Bitcoin transaction within 2 minutes. Refresh prices to continue.'
      : 'This payment window expired. Refresh prices to continue.';
    node.hidden = false;
    node.innerHTML = `
      <div class="status-card">
        <span class="badge warn">Payment window expired</span>
        <div class="status-copy">${expiredCopy}</div>
        <button type="button" id="statusRefreshQuoteBtn" class="secondary-button">Refresh prices</button>
      </div>
    `;
    node.querySelector?.('#statusRefreshQuoteBtn')?.addEventListener('click', () => refreshQuote().catch(alert));
    return;
  }

  node.hidden = true;
  node.textContent = '';
}

function renderManualPanel() {
  const toggle = document.getElementById('manualToggleBtn');
  const panel = document.getElementById('manualPanel');
  const routeOptions = document.getElementById('manualRouteOptions');
  if (!toggle || !panel) return;
  const available = manualPaymentAvailable();
  toggle.hidden = !available || manualPanelOpen || walletConnected || state?.checkout?.status === 'paid';
  panel.hidden = !manualPanelOpen || !available || state?.checkout?.status === 'paid' || paymentWindowExpired();
  if (!available || !manualPanelOpen) return;

  const route = selectedManualRoute();
  if (route) manualSelectedRouteKey = route.key;
  const preferred = route?.preferredQuote || null;
  const amountCopy = preferred?.cryptoAmount || state?.checkout?.amountUsd?.toFixed?.(2) || '0.00';
  const assetList = route?.acceptedAssets || [];
  const chainList = route?.enabledChains || [];
  const summary = route?.chain === 'bitcoin'
    ? `Send exactly ${amountCopy} BTC to this unique Bitcoin address. We watch the address automatically and confirm after the required block depth.`
    : assetList.length
      ? `Send exactly ${amountCopy} in ${assetList.join(' or ')} to this unique deposit address. We confirm supported transfers automatically.`
      : 'Send the exact amount to this unique deposit address. We confirm supported transfers automatically.';

  document.getElementById('manualSummary').textContent = summary;
  document.getElementById('manualAmount').textContent = preferred ? `${preferred.cryptoAmount} ${preferred.asset}` : amountCopy;
  document.getElementById('manualAddress').textContent = route?.address || 'Address unavailable';
  document.getElementById('manualAssets').innerHTML = assetList.map((asset) => `<span class="asset-pill">${asset}</span>`).join('');
  document.getElementById('manualChains').innerHTML = chainList.map((chain) => `<span class="asset-pill">${chainLabel(chain)}</span>`).join('');
  document.getElementById('manualQr').innerHTML = route?.qrSvg || '<div class="muted">QR unavailable</div>';

  if (routeOptions) {
    routeOptions.innerHTML = manualRoutes().map((entry) =>
      `<button type="button" class="tiny-link ${entry.key === manualSelectedRouteKey ? 'manual-route-active' : ''}" data-manual-route="${entry.key}">${chainLabel(entry.chain)} · ${entry.asset}</button>`
    ).join('');
    routeOptions.querySelectorAll?.('[data-manual-route]').forEach((button) => {
      button.addEventListener('click', () => {
        manualSelectedRouteKey = button.dataset.manualRoute;
        renderAll();
      });
    });
  }

  const watchingBadge = document.getElementById('manualWatchingBadge');
  const manualStatus = document.getElementById('manualStatus');
  if (watchingBadge) {
    watchingBadge.className = `badge ${state?.checkout?.status === 'paid' ? 'ok' : 'warn'}`;
    watchingBadge.textContent = state?.checkout?.status === 'paid' ? 'Payment found' : route?.chain === 'bitcoin' ? 'Watching Bitcoin' : 'Watching chains';
  }
  if (manualStatus) {
    if (state?.checkout?.status === 'paid') {
      const payment = (state?.payments || []).find((entry) => entry.status === 'confirmed') || null;
      manualStatus.innerHTML = payment?.txHash
        ? `Payment confirmed on ${chainLabel(payment.chain)}. <a href="${explorerTx(payment.chain, payment.txHash)}" target="_blank">View transaction</a>`
        : 'Payment confirmed onchain.';
    } else if (route?.chain === 'bitcoin') {
      manualStatus.textContent = 'We watch the checkout address automatically after you send BTC. No tx hash is required.';
    } else {
      manualStatus.textContent = 'We monitor supported chains automatically after you send the funds. No tx hash or wallet connection is required.';
    }
  }
}

function renderSuccess(checkout, payments) {
  const successScreen = document.getElementById('successScreen');
  const flow = document.getElementById('checkoutFlow');
  if (!checkout || checkout.status !== 'paid') {
    successScreen.hidden = true;
    flow.hidden = false;
    return;
  }

  const paidPayment = (payments || []).find((payment) => payment.status === 'confirmed') || payments?.[0] || null;
  const chain = paidPayment?.chain || checkout.paidChain || checkout.defaultChain;
  const asset = paidPayment?.asset || checkout.paidAsset || checkout.defaultAsset || checkout.asset;
  document.getElementById('successCopy').textContent = `${checkout.title || 'Payment'} was confirmed on ${chainLabel(chain)}.`;
  document.getElementById('successMeta').innerHTML = `
    <div class="success-meta-row">
      <span>Amount</span>
      <strong>$${checkout.amountUsd.toFixed(2)}</strong>
    </div>
    <div class="success-meta-row">
      <span>Asset</span>
      <strong>${asset}</strong>
    </div>
    <div class="success-meta-row">
      <span>Network</span>
      <strong>${chainLabel(chain)}</strong>
    </div>
    ${paidPayment?.txHash ? `<div class="success-meta-row"><span>Transaction</span><strong><a href="${explorerTx(chain, paidPayment.txHash)}" target="_blank">${paidPayment.txHash.slice(0, 10)}...</a></strong></div>` : ''}
  `;

  const returnLink = document.getElementById('successReturnLink');
  if (checkout.successUrl) {
    returnLink.href = checkout.successUrl;
    returnLink.hidden = false;
  } else {
    returnLink.hidden = true;
  }

  successScreen.hidden = false;
  flow.hidden = true;
}

function syncPayButton() {
  const payBtn = document.getElementById('payBtn');
  const refreshBtn = document.getElementById('refreshRouteBtn');
  const connectBtn = document.getElementById('connectWalletBtn');
  const payActions = document.getElementById('payActions');
  const quote = recommendedQuote();
  const payable = quote ? isQuotePayable(quote) : false;
  const canPay = walletSupportsPayAction(quote);

  if (payBtn) {
    payBtn.disabled = !checkoutReady || !walletConnected || !quote || !payable || state?.checkout?.status === 'paid';
    payBtn.textContent = quote ? `Pay ${quote.cryptoAmount} ${quote.asset}` : 'Pay';
    if (!canPay && quote) payBtn.textContent = 'Use payment address';
  }
  if (connectBtn) connectBtn.disabled = !checkoutReady;
  if (refreshBtn) {
    refreshBtn.disabled = !checkoutReady;
    refreshBtn.hidden = !refreshNeeded() && !paymentWindowExpired();
  }
  if (payActions) payActions.hidden = !walletConnected || manualPanelOpen || state?.checkout?.status === 'paid';
}

function updateStatusPolling() {
  const hasPendingOnchain = Boolean(state?.checkout && state.checkout.status !== 'paid' && pendingOnchainPayment());
  const watchManual = Boolean(state?.checkout && state.checkout.status !== 'paid' && manualPaymentAvailable() && manualPanelOpen);
  const shouldPoll = hasPendingOnchain || watchManual;
  if (!shouldPoll && statusPollTimer) {
    clearTimeout(statusPollTimer);
    statusPollTimer = null;
    return;
  }
  if (!shouldPoll || statusPollTimer) return;
  statusPollTimer = setTimeout(async () => {
    statusPollTimer = null;
    try {
      await refreshStatus();
    } catch (_err) {
    }
    updateStatusPolling();
  }, statusPollDelayMs);
}

function updatePaymentWindowTimer() {
  if (paymentWindowTimer) {
    clearTimeout(paymentWindowTimer);
    paymentWindowTimer = null;
  }
  const remaining = paymentWindowRemainingMs();
  if (remaining == null || remaining <= 0 || state?.checkout?.status === 'paid' || pendingOnchainPayment()) return;
  paymentWindowTimer = setTimeout(() => {
    paymentWindowTimer = null;
    renderAll();
  }, Math.min(1000, remaining));
}

function renderAll() {
  if (!state?.checkout) return;
  renderHero(state.checkout);
  renderSummary(state.checkout);
  renderWalletMeta();
  renderManualPanel();
  renderRecommendation();
  renderQuoteOptions();
  renderStatus(state.checkout, state.payments || []);
  renderSuccess(state.checkout, state.payments || []);
  syncPayButton();
  updateStatusPolling();
  updatePaymentWindowTimer();
}

async function refreshStatus({ includeConfig = false } = {}) {
  const next = await getJson(`/api/checkouts/${checkoutId}/status`);
  state = {
    ...state,
    ...next,
    balances: state?.balances || {},
    config: includeConfig ? await getJson('/api/config') : state?.config,
    manualDetails: state?.manualDetails || null
  };
  checkoutReady = true;
  renderAll();
}

async function refreshView() {
  checkoutReady = false;
  syncPayButton();
  const initial = readCheckoutBootstrap() || await getJson(`/api/checkouts/${checkoutId}`);
  state = {
    ...state,
    ...initial,
    payments: initial.payments || state?.payments || [],
    balances: state?.balances || {},
    config: state?.config || null,
    manualDetails: state?.manualDetails || null
  };
  checkoutReady = true;
  renderAll();
  if (!state.config) {
    getJson('/api/config')
      .then((config) => {
        state.config = config;
        renderAll();
      })
      .catch(() => {});
  }
  refreshStatus().catch(() => {});
}

async function refreshQuote() {
  const quote = recommendedQuote();
  const refreshed = await getJson(`/api/checkouts/${checkoutId}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(quote ? { chain: quote.chain, asset: quote.asset } : {})
  });
  const byRoute = new Map((state.quotes || []).map((entry) => [quoteKey(entry), entry]));
  for (const entry of refreshed.quotes || []) byRoute.set(quoteKey(entry), entry);
  state.quotes = [...byRoute.values()];
  if (manualPanelOpen) await loadManualDetails();
  renderAll();
}

async function submitTx(txHash, walletAddress, quote) {
  await getJson(`/api/checkouts/${checkoutId}/submit-tx`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txHash, walletAddress, chain: quote.chain, asset: quote.asset, quoteId: quote.id })
  });
  await refreshStatus();
}

async function loadManualDetails() {
  if (!manualPaymentAvailable()) return null;
  const details = await getJson(`/api/checkouts/${checkoutId}/manual-payment`);
  state.manualDetails = details;
  manualDetailsLoaded = true;
  manualSelectedRouteKey = details.preferredRouteKey || manualSelectedRouteKey;
  return details;
}

async function openManualPanel(routeKey = '') {
  if (!manualPaymentAvailable()) return;
  manualPanelOpen = true;
  if (!manualDetailsLoaded) await loadManualDetails();
  if (routeKey) manualSelectedRouteKey = routeKey;
  renderAll();
}

async function switchToWalletMode({ connect = false } = {}) {
  manualPanelOpen = false;
  renderAll();
  if (connect) await detectBalances();
}

async function copyManualAddress() {
  const route = selectedManualRoute();
  const address = route?.address || state?.manualDetails?.address || state?.checkout?.manualPayment?.address;
  if (!address) throw new Error('manual address unavailable');
  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(address);
  }
  const button = document.getElementById('copyManualAddressBtn');
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

async function connectInjectedEvm() {
  if (!window.ethereum) throw new Error('no injected wallet found');
  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!address) throw new Error('wallet did not return an address');
  return { rail: 'evm', provider: 'injected-evm', address };
}

async function connectXverseBitcoin() {
  const xverse = vendors().xverse;
  if (!xverse?.request || !xverse?.setDefaultProvider) throw new Error('xverse wallet adapter unavailable');
  const providerId = xverse.DefaultAdaptersInfo?.xverse?.id;
  if (providerId) xverse.setDefaultProvider(providerId);

  let response = await xverse.request('wallet_connect', {
    addresses: ['payment'],
    network: 'Mainnet',
    message: 'Charge With Crypto wants to connect your Bitcoin payment address.'
  });

  let accounts = xverseAddressItems(response);
  if ((!accounts.length) && xverse.AddressPurpose) {
    response = await xverse.request('getAccounts', {
      purposes: [xverse.AddressPurpose.Payment],
      message: 'Charge With Crypto wants to connect your Bitcoin payment address.'
    });
    accounts = xverseAddressItems(response);
  }

  if (response?.status === 'error') {
    throw new Error(response?.error?.message || 'xverse address request failed');
  }

  const paymentAccount = (accounts || []).find((account) => String(account.purpose).toLowerCase() === 'payment') || accounts?.[0];
  if (!paymentAccount?.address) throw new Error('xverse did not return a payment address');
  return { rail: 'bitcoin', provider: 'xverse', address: paymentAccount.address };
}

async function connectWallet(providerId = defaultWalletProviderId()) {
  if (!providerId) throw new Error('no wallet provider is available for this checkout');
  if (providerId === 'xverse') return connectXverseBitcoin();
  return connectInjectedEvm();
}

async function scanConnectedWallet(session) {
  const scan = await getJson(`/api/checkouts/${checkoutId}/balance-scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: session.address, walletRail: session.rail })
  });
  walletSession = session;
  currentWalletAddress = session.address;
  walletConnected = true;
  manualPanelOpen = false;
  state.balances = { ...(state.balances || {}), ...(scan.balances || {}) };
  renderAll();
}

async function detectBalances(providerId = defaultWalletProviderId()) {
  if (!checkoutReady || !state) throw new Error('checkout is still loading');
  const session = await connectWallet(providerId);
  await scanConnectedWallet(session);
}

async function payWithInjectedEvm(quote) {
  if (!window.ethereum) throw new Error('no injected wallet found');
  const checkout = state.checkout;
  const config = state?.config || await getJson('/api/config');
  const [walletAddress] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainConfig = config.chains[quote.chain];
  const recipientAddress = checkout.recipientByChain?.[quote.chain] || checkout.recipientAddress;

  await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex(chainConfig.chainId) }] });

  let txHash;
  if (quote.asset === 'ETH') {
    txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: walletAddress, to: recipientAddress, value: `0x${BigInt(quote.cryptoAmountBaseUnits).toString(16)}` }]
    });
  } else {
    const tokenAddress = config.assets[quote.asset].addresses[quote.chain];
    const methodId = '0xa9059cbb';
    const toArg = recipientAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const amountArg = BigInt(quote.cryptoAmountBaseUnits).toString(16).padStart(64, '0');
    txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: walletAddress, to: tokenAddress, data: `${methodId}${toArg}${amountArg}` }]
    });
  }

  await submitTx(txHash, walletAddress, quote);
}

async function payWithXverseBitcoin(quote) {
  const xverse = vendors().xverse;
  if (!xverse?.request || !xverse?.setDefaultProvider) throw new Error('xverse wallet adapter unavailable');
  xverse.setDefaultProvider(xverse.DefaultAdaptersInfo.xverse.id);
  const amount = Number(quote.cryptoAmountBaseUnits);
  if (!Number.isSafeInteger(amount)) throw new Error('bitcoin amount exceeds safe integer range');
  const response = await xverse.request('sendTransfer', {
    recipients: [
      {
        address: state.checkout.recipientByChain?.bitcoin || state.checkout.recipientAddress,
        amount
      }
    ]
  });
  if (response?.status === 'error') {
    throw new Error(response?.error?.message || 'xverse transfer failed');
  }
  const txid = response?.result?.txid || response?.txid;
  if (!txid) throw new Error('xverse transfer did not return a txid');
  await submitTx(txid, walletSession.address, quote);
}

async function payWithWallet() {
  if (!checkoutReady || !state) throw new Error('checkout is still loading');
  const quote = recommendedQuote();
  if (!quote) throw new Error('quote missing or expired');
  if (!isQuotePayable(quote)) throw new Error('not enough balance on the recommended route');

  if (!walletSupportsPayAction(quote)) {
    await openManualPanel(quote.chain === 'bitcoin' ? 'bitcoin' : 'evm');
    throw new Error('Use the payment address below to send funds from this wallet.');
  }

  if (walletProviderId() === 'xverse') {
    await payWithXverseBitcoin(quote);
    return;
  }

  await payWithInjectedEvm(quote);
}

document.getElementById('connectWalletBtn').addEventListener('click', () => detectBalances().catch(alert));
document.getElementById('payBtn').addEventListener('click', () => payWithWallet().catch(alert));
document.getElementById('refreshRouteBtn').addEventListener('click', () => refreshQuote().catch(alert));
document.getElementById('manualToggleBtn').addEventListener('click', () => openManualPanel().catch(alert));
document.getElementById('connectInsteadBtn').addEventListener('click', () => switchToWalletMode({ connect: true }).catch(alert));
document.getElementById('copyManualAddressBtn').addEventListener('click', () => copyManualAddress().catch(alert));

syncPayButton();
refreshView().catch((err) => {
  document.getElementById('summary').textContent = err.message;
});
