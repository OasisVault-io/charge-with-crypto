const checkoutId = new URLSearchParams(window.location.search).get('id');
const preferredChainOrder = ['base', 'arbitrum', 'polygon', 'ethereum'];
const preferredAssetOrder = ['USDC', 'USDT', 'ETH'];
const statusPollDelayMs = 3000;
const preConnectWalletCopy = 'Connect a wallet to review the best route for this payment.';
const defaultMerchantLogo = '/charge-with-crypto-mark.svg';
const checkoutTemplateParam = new URLSearchParams(window.location.search).get('template');
const dueAmountFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let state = null;
let currentWalletAddress = null;
let walletConnected = false;
let checkoutReady = false;
let statusPollTimer = null;
let manualPanelOpen = false;
let manualDetailsLoaded = false;

function quoteKey(quote) {
  return `${quote.chain}:${quote.asset}`;
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

function assetUnitsDisplay(raw, decimals, precision = 6) {
  const value = BigInt(raw || '0');
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = String(value % scale).padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function shortAddress(address) {
  if (!address) return '';
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdAmount(amount) {
  return dueAmountFormatter.format(Number(amount || 0));
}

function applyDueAmountSizing(node, amountText) {
  if (!node?.classList) return;
  const digitCount = String(amountText || '').replace(/\D/g, '').length;
  node.classList.remove('hero-amount-tight', 'hero-amount-compact', 'hero-amount-ultra');
  if (digitCount >= 10) {
    node.classList.add('hero-amount-ultra');
  } else if (digitCount >= 8) {
    node.classList.add('hero-amount-compact');
  } else if (digitCount >= 6) {
    node.classList.add('hero-amount-tight');
  }
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
  if (!state?.quotes?.length) return null;
  const payable = state.quotes.filter((quote) => isQuotePayable(quote));
  const ranked = payable.length ? payable : state.quotes;
  return [...ranked].sort((a, b) => routeScore(a) - routeScore(b))[0] || null;
}

function manualPaymentAvailable() {
  return Boolean(state?.checkout?.manualPayment?.available);
}

function manualSupportedQuotes() {
  const manual = state?.checkout?.manualPayment;
  if (!manual?.available) return [];
  const enabledChains = new Set(manual.enabledChains || []);
  const acceptedAssets = new Set(manual.acceptedAssets || []);
  return (state?.quotes || []).filter((quote) => enabledChains.has(quote.chain) && acceptedAssets.has(quote.asset));
}

function preferredManualQuote() {
  const quotes = manualSupportedQuotes();
  return [...quotes].sort((a, b) => routeScore(a) - routeScore(b))[0] || null;
}

function pendingOnchainPayment(payments = []) {
  return payments.find((payment) => payment.method === 'onchain' && payment.status !== 'confirmed' && payment.txHash);
}

function refreshNeeded() {
  const fixedAssets = new Set(state?.config?.fixedPriceAssets || []);
  const assets = state?.checkout?.acceptedAssets || [];
  return assets.some((asset) => !fixedAssets.has(asset));
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
    node.innerHTML = `<span class="badge warn">Route unavailable</span><p class="muted">${refreshNeeded() ? 'Refresh prices to continue.' : 'Reconnect wallet to continue.'}</p>`;
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
    <p class="muted">Charge With Crypto scans supported balances and keeps the customer flow to one recommended route.</p>
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
    node.innerHTML = `<div class="route-card"><span class="badge warn">Route unavailable</span><span class="muted">${refreshNeeded() ? 'Refresh quote to continue.' : 'Reconnect wallet to continue.'}</span></div>`;
    return;
  }

  const balance = balanceForQuote(quote);
  const payable = isQuotePayable(quote);
  const reason = payable
    ? `Detected balance makes ${chainLabel(quote.chain)} the cleanest route right now.`
    : `This is still the cleanest route, but the connected wallet does not hold enough ${quote.asset} here yet.`;
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
  const pending = pendingOnchainPayment(payments || []);
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

  node.hidden = true;
  node.textContent = '';
}

function renderWalletMeta() {
  const node = document.getElementById('walletMeta');
  const hero = document.getElementById('walletHero');
  const connectBtn = document.getElementById('connectWalletBtn');
  const heading = document.getElementById('walletHeading');
  const stepLabel = document.getElementById('walletStepLabel');
  if (!node) return;
  if (hero) hero.hidden = Boolean(manualPanelOpen && state?.checkout?.status !== 'paid');
  if (!walletConnected || !currentWalletAddress) {
    node.textContent = preConnectWalletCopy;
    hero?.classList.remove('wallet-connected');
    hero?.classList.remove('wallet-stage-compact');
    if (heading) {
      heading.textContent = 'Connect a wallet';
      heading.hidden = false;
    }
    if (stepLabel) stepLabel.hidden = false;
    if (connectBtn) connectBtn.hidden = false;
    return;
  }

  const scannedChains = [...new Set((state?.quotes || []).map((quote) => chainLabel(quote.chain)))].join(', ');
  node.innerHTML = `
    <span class="wallet-copy-line">
      Connected wallet <span class="code wallet-chip">${shortAddress(currentWalletAddress)}</span>
    </span>
    ${scannedChains ? `<span class="wallet-scan-line muted">Scanned ${scannedChains}.</span>` : ''}
  `;
  hero?.classList.add('wallet-connected');
  hero?.classList.add('wallet-stage-compact');
  if (heading) heading.hidden = true;
  if (stepLabel) stepLabel.hidden = true;
  if (connectBtn) connectBtn.hidden = true;
}

function renderManualPanel() {
  const toggle = document.getElementById('manualToggleBtn');
  const panel = document.getElementById('manualPanel');
  if (!toggle || !panel) return;
  const available = manualPaymentAvailable();
  toggle.hidden = !available || manualPanelOpen || walletConnected || state?.checkout?.status === 'paid';
  panel.hidden = !manualPanelOpen || !available || state?.checkout?.status === 'paid';
  if (!available || !manualPanelOpen) return;

  const manual = state?.manualDetails || {};
  const preferred = manual.preferredQuote || preferredManualQuote();
  const assetList = manual.acceptedAssets || state?.checkout?.manualPayment?.acceptedAssets || [];
  const chainList = manual.enabledChains || state?.checkout?.manualPayment?.enabledChains || [];
  const amountCopy = preferred?.cryptoAmount || state?.checkout?.amountUsd?.toFixed?.(2) || '0.00';
  const summary = assetList.length
    ? `Send exactly ${amountCopy} in ${assetList.join(' or ')} to this unique deposit address. We confirm supported transfers automatically.`
    : 'Send the exact stablecoin amount to this unique deposit address. We confirm supported transfers automatically.';

  document.getElementById('manualSummary').textContent = summary;
  document.getElementById('manualAmount').textContent = amountCopy;
  document.getElementById('manualAddress').textContent = manual.address || state?.checkout?.manualPayment?.address || 'Address unavailable';
  document.getElementById('manualAssets').innerHTML = assetList.map((asset) => `<span class="asset-pill">${asset}</span>`).join('');
  document.getElementById('manualChains').innerHTML = chainList.map((chain) => `<span class="asset-pill">${chainLabel(chain)}</span>`).join('');
  document.getElementById('manualQr').innerHTML = manual.qrSvg || '<div class="muted">QR unavailable</div>';

  const manualState = state?.checkout?.manualPayment || {};
  const watchingBadge = document.getElementById('manualWatchingBadge');
  const manualStatus = document.getElementById('manualStatus');
  if (watchingBadge) {
    watchingBadge.className = `badge ${state?.checkout?.status === 'paid' ? 'ok' : 'warn'}`;
    watchingBadge.textContent = state?.checkout?.status === 'paid' ? 'Payment found' : 'Watching chains';
  }
  if (manualStatus) {
    if (state?.checkout?.status === 'paid') {
      const payment = (state?.payments || []).find((entry) => entry.status === 'confirmed') || null;
      manualStatus.innerHTML = payment?.txHash
        ? `Payment confirmed on ${chainLabel(payment.chain)}. <a href="${explorerTx(payment.chain, payment.txHash)}" target="_blank">View transaction</a>`
        : 'Payment confirmed onchain.';
    } else if (manualState.detectedTxHash) {
      manualStatus.innerHTML = `Detected ${manualState.detectedAsset} on ${chainLabel(manualState.detectedChain)}. Confirming settlement.`;
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

  payBtn.disabled = !checkoutReady || !walletConnected || !quote || !payable || state?.checkout?.status === 'paid';
  payBtn.textContent = quote ? `Pay ${quote.cryptoAmount} ${quote.asset}` : 'Pay';
  if (connectBtn) connectBtn.disabled = !checkoutReady;
  if (refreshBtn) {
    refreshBtn.disabled = !checkoutReady;
    refreshBtn.hidden = !refreshNeeded();
  }
  if (payActions) payActions.hidden = !walletConnected || manualPanelOpen || state?.checkout?.status === 'paid';
}

function updateStatusPolling() {
  const hasPendingOnchain = Boolean(state?.checkout && state.checkout.status !== 'paid' && pendingOnchainPayment(state.payments));
  const watchManual = Boolean(
    state?.checkout &&
    state.checkout.status !== 'paid' &&
    manualPaymentAvailable() &&
    (manualPanelOpen || state?.checkout?.manualPayment?.detectedTxHash)
  );
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
  const refreshed = await getJson(`/api/checkouts/${checkoutId}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  const byRoute = new Map((state.quotes || []).map((quote) => [quoteKey(quote), quote]));
  for (const quote of refreshed.quotes || []) byRoute.set(quoteKey(quote), quote);
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
  return details;
}

async function openManualPanel() {
  if (!manualPaymentAvailable()) return;
  manualPanelOpen = true;
  if (!manualDetailsLoaded) await loadManualDetails();
  renderAll();
}

async function switchToWalletMode({ connect = false } = {}) {
  manualPanelOpen = false;
  renderAll();
  if (connect) await detectBalances();
}

async function copyManualAddress() {
  const address = state?.manualDetails?.address || state?.checkout?.manualPayment?.address;
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

async function detectBalances() {
  if (!checkoutReady || !state) throw new Error('checkout is still loading');
  if (!window.ethereum) throw new Error('no injected wallet found');
  manualPanelOpen = false;
  const [walletAddress] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  currentWalletAddress = walletAddress;
  walletConnected = true;
  const scan = await getJson(`/api/checkouts/${checkoutId}/balance-scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress })
  });
  state.balances = scan.balances || {};
  renderAll();
}

async function payWithWallet() {
  if (!checkoutReady || !state) throw new Error('checkout is still loading');
  if (!window.ethereum) throw new Error('no injected wallet found');
  const quote = recommendedQuote();
  if (!quote) throw new Error('quote missing or expired');
  if (!isQuotePayable(quote)) throw new Error('not enough balance on the recommended route');

  const { checkout } = state;
  const config = state?.config || await getJson('/api/config');
  const [walletAddress] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  currentWalletAddress = walletAddress;
  walletConnected = true;
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
