// @ts-nocheck
const merchantId = new URLSearchParams(window.location.search).get('merchantId') || 'merchant_demo';
const defaultMerchantLogo = '/charge-with-crypto-mark.svg';
const dashboardTokenStorageKey = 'charge-with-crypto.dashboard-token';
let appConfig = null;
let dashboardState = null;
let uploadedLogoDataUrl = '';
let merchantPlans = [];
let expandedPlanIndex = null;
let activeDashboardSection = 'overview';
let dashboardToken = localStorage.getItem(dashboardTokenStorageKey) || '';
let dashboardCanEdit = false;
let paymentFilterState = { search: '', status: 'all', method: 'all', range: '30d' };

async function getJson(url, options) {
  const headers = new Headers(options?.headers || {});
  if (dashboardToken) headers.set('x-dashboard-token', dashboardToken);
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function setEditingEnabled(enabled, message = '') {
  dashboardCanEdit = Boolean(enabled);
  document.querySelectorAll('#merchantForm input, #merchantForm textarea, #merchantForm select, #merchantForm button').forEach((node) => {
    node.disabled = !dashboardCanEdit;
  });
  document.querySelectorAll('#checkoutForm input, #checkoutForm textarea, #checkoutForm select, #checkoutForm button').forEach((node) => {
    node.disabled = !dashboardCanEdit;
  });
  document.getElementById('dashboardAuthPanel').hidden = dashboardCanEdit || !appConfig?.dashboardAuthConfigured;
  document.getElementById('dashboardAuthStatus').textContent = message;
}

function checkboxMarkup(name, value, label) {
  return `<label class="checkbox-pill"><input type="checkbox" name="${name}" value="${value}" /> <span>${label}</span></label>`;
}

function normalizePaymentRail(value, fallback = 'evm') {
  return value === 'bitcoin' ? 'bitcoin' : fallback === 'bitcoin' ? 'bitcoin' : 'evm';
}

function chainRail(chain) {
  return chain === 'bitcoin' ? 'bitcoin' : 'evm';
}

function assetRail(asset) {
  return asset === 'BTC' ? 'bitcoin' : 'evm';
}

function inferPaymentRail({ paymentRail, enabledChains = [], acceptedAssets = [], fallback = 'evm' } = {}) {
  const explicit = paymentRail ? normalizePaymentRail(paymentRail, fallback) : '';
  if (explicit) return explicit;
  const rails = [...new Set([...(enabledChains || []).map((chain) => chainRail(chain)), ...(acceptedAssets || []).map((asset) => assetRail(asset))])];
  return rails.length === 1 ? rails[0] : normalizePaymentRail(fallback, 'evm');
}

function railLabel(rail) {
  return normalizePaymentRail(rail) === 'bitcoin' ? 'Bitcoin' : 'EVM';
}

function valuesForRail(values, rail, kind) {
  const matcher = kind === 'chain' ? chainRail : assetRail;
  return (values || []).filter((value) => matcher(value) === rail);
}

function defaultRailSelection(rail, kind) {
  if (kind === 'chain') {
    const chains = Object.keys(appConfig?.chains || {}).filter((chain) => chainRail(chain) === rail);
    if (rail === 'bitcoin') return chains.slice(0, 1);
    return chains.includes('base') ? ['base'] : chains.slice(0, 1);
  }
  const assets = Object.keys(appConfig?.assets || {}).filter((asset) => assetRail(asset) === rail);
  if (rail === 'bitcoin') return assets.includes('BTC') ? ['BTC'] : assets.slice(0, 1);
  const preferred = ['USDC', 'USDT'].filter((asset) => assets.includes(asset));
  return preferred.length ? preferred : assets.slice(0, 1);
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'n/a';
}

function daysAgo(days) {
  return Date.now() - (Number(days) * 24 * 60 * 60 * 1000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function explorerTx(chain, txHash) {
  const base = {
    ethereum: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    polygon: 'https://polygonscan.com/tx/'
  }[chain];
  return base && txHash ? `${base}${txHash}` : '';
}

function newPlan() {
  return {
    id: `plan_${Math.random().toString(36).slice(2, 8)}`,
    title: 'New plan',
    description: '',
    amountUsd: 10,
    paymentRail: 'evm',
    enabledChains: ['base'],
    acceptedAssets: ['USDC', 'USDT']
  };
}

function safeLogoSrc(value) {
  return value || defaultMerchantLogo;
}

function setPreviewLogo(value) {
  const image = document.getElementById('merchantLogoPreview');
  image.src = safeLogoSrc(value);
  image.onerror = () => {
    image.onerror = null;
    image.src = defaultMerchantLogo;
  };
}

function setCheckedValues(containerId, values) {
  const set = new Set(values || []);
  document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach((input) => {
    input.checked = set.has(input.value);
  });
}

function readCheckedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)].map((input) => input.value);
}

function syncRailCheckboxGroup(containerId, rail, kind, fallbackValues = []) {
  const current = valuesForRail(readCheckedValues(containerId), rail, kind);
  const fallback = valuesForRail(fallbackValues, rail, kind);
  const next = current.length ? current : fallback;
  document.querySelectorAll(`#${containerId} .checkbox-pill`).forEach((label) => {
    const input = label.querySelector('input');
    const matches = (kind === 'chain' ? chainRail(input.value) : assetRail(input.value)) === rail;
    label.hidden = !matches;
    input.disabled = !matches;
    if (!matches) input.checked = false;
  });
  setCheckedValues(containerId, next);
}

function linesToList(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function listToLines(values) {
  return (values || []).join('\n');
}

function renderManualEngineStatus(config) {
  const node = document.getElementById('manualEngineStatus');
  if (!node) return;
  const status = config?.manualPayment || { configured: false, sponsorAddress: '', derivationPath: '' };
  const bitcoinConfigured = Boolean(status?.bitcoin?.configured);
  if (!status.configured) {
    node.innerHTML = `
      <span class="badge warn">Server setup required</span>
      <span class="muted">Set the manual payment mnemonic and sweep sponsor key in the server environment before enabling manual pay for customers.</span>
    `;
    return;
  }
  node.innerHTML = `
    <span class="badge ok">Engine configured</span>
    <span class="muted">Path ${status.derivationPath}</span>
    <span class="muted">Sponsor ${status.sponsorAddress || 'n/a'}</span>
    <span class="muted">Bitcoin watcher ${bitcoinConfigured ? 'ready' : 'not configured'}</span>
  `;
}

function planCheckboxMarkup({ group, value, label, checked }) {
  return `<label class="checkbox-pill"><input type="checkbox" data-plan-group="${group}" value="${value}" ${checked ? 'checked' : ''} /> <span>${label}</span></label>`;
}

function merchantPayments(data) {
  const checkoutMap = new Map((data.checkouts || []).map((checkout) => [checkout.id, checkout]));
  return (data.payments || [])
    .filter((payment) => checkoutMap.has(payment.checkoutId))
    .map((payment) => ({ ...payment, checkout: checkoutMap.get(payment.checkoutId) }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function chainLabel(chain) {
  return appConfig?.chains?.[chain]?.name || chain || 'Unknown';
}

function merchantSettlementConfigured(merchant, chain) {
  return chain === 'bitcoin'
    ? Boolean(merchant?.recipientAddresses?.bitcoin || merchant?.bitcoinXpub)
    : Boolean(merchant?.recipientAddresses?.[chain]);
}

function paymentTone(status) {
  return status === 'confirmed' ? 'ok' : 'warn';
}

function brandPreviewPayload() {
  return {
    brandName: document.getElementById('merchantBrandName')?.value.trim() || '',
    name: document.getElementById('merchantName')?.value.trim() || '',
    logoUrl: uploadedLogoDataUrl || document.getElementById('merchantLogoUrl')?.value.trim() || '',
    headline: document.getElementById('merchantHeadline')?.value.trim() || '',
    description: document.getElementById('merchantDescription')?.value.trim() || ''
  };
}

function renderBrandPreview() {
  const node = document.getElementById('brandPreviewCard');
  if (!node) return;
  const preview = brandPreviewPayload();
  const merchantName = preview.brandName || preview.name || 'Merchant name';
  const headline = preview.headline || 'Fast wallet-first crypto checkout';
  const description = preview.description || 'Customers connect a wallet, get one recommended route, and pay in one confirmation.';
  node.innerHTML = `
    <div class="brand-preview-head">
      <img class="summary-logo" src="${safeLogoSrc(preview.logoUrl)}" alt="${escapeHtml(merchantName)} logo" />
      <div class="stack-sm">
        <span class="eyebrow">Hosted checkout preview</span>
        <strong>${escapeHtml(merchantName)}</strong>
      </div>
    </div>
    <div class="brand-preview-copy">
      <strong>${escapeHtml(headline)}</strong>
      <p class="muted">${escapeHtml(description)}</p>
    </div>
  `;
  node.querySelector('img')?.addEventListener('error', (event) => {
    event.currentTarget.src = defaultMerchantLogo;
  }, { once: true });
}

function setMerchantStatus(message) {
  const ids = ['merchantSaveStatus', 'merchantSettingsStatus', 'merchantPlansStatus'];
  ids.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.textContent = message;
  });
}

function setDashboardSection(section, { syncHash = true } = {}) {
  const allowed = new Set(['overview', 'brand', 'settings', 'plans', 'checkout', 'payments', 'activity']);
  activeDashboardSection = allowed.has(section) ? section : 'overview';
  document.querySelectorAll('[data-dashboard-section]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.dashboardSection === activeDashboardSection);
  });
  document.querySelectorAll('.dashboard-panel').forEach((panel) => {
    panel.hidden = panel.id !== `dashboardSection${activeDashboardSection[0].toUpperCase()}${activeDashboardSection.slice(1)}`;
  });
  if (syncHash) window.location.hash = activeDashboardSection;
}

function renderPlanSelect(plans, selectedPlanId) {
  const select = document.getElementById('checkoutPlanId');
  const activePlanId = selectedPlanId ?? select.value;
  select.innerHTML = ['<option value="">Custom checkout</option>']
    .concat((plans || []).map((plan) => `<option value="${escapeHtml(plan.id)}" ${plan.id === activePlanId ? 'selected' : ''}>${escapeHtml(plan.title)} (${escapeHtml(plan.id)})</option>`))
    .join('');
  renderCheckoutPlanSummary();
  syncCheckoutOverrides();
}

function renderPlansEditor(plans) {
  const activePlanId = document.getElementById('checkoutPlanId')?.value || '';
  merchantPlans = (plans || []).map((plan) => ({
    id: plan.id || '',
    title: plan.title || plan.name || '',
    description: plan.description || '',
    amountUsd: Number(plan.amountUsd || 0),
    paymentRail: inferPaymentRail(plan),
    enabledChains: plan.enabledChains || [],
    acceptedAssets: plan.acceptedAssets || []
  }));

  if (expandedPlanIndex != null && expandedPlanIndex >= merchantPlans.length) {
    expandedPlanIndex = merchantPlans.length ? merchantPlans.length - 1 : null;
  }

  document.getElementById('plansEditor').innerHTML = merchantPlans.length
    ? merchantPlans.map((plan, index) => `
      <section class="card plan-card">
        <div class="plan-card-head">
          <div class="plan-card-summary">
            <div class="plan-title-row">
              <strong>${escapeHtml(plan.title || `Plan ${index + 1}`)}</strong>
              <span class="badge ok">${formatUsd(plan.amountUsd)}</span>
              <span class="code">${escapeHtml(plan.id || `plan_${index + 1}`)}</span>
            </div>
            <div class="plan-meta-row">
              <span class="plan-meta-chip">${railLabel(plan.paymentRail)}</span>
              <span class="plan-meta-chip">${(plan.enabledChains || []).length} network${(plan.enabledChains || []).length === 1 ? '' : 's'}</span>
              <span class="plan-meta-chip">${escapeHtml((plan.acceptedAssets || []).join(' · ') || 'No assets selected')}</span>
              <span class="plan-meta-chip">${escapeHtml(plan.description || 'No description yet')}</span>
            </div>
          </div>
          <div class="inline-actions">
            <button type="button" class="secondary-button" data-toggle-plan="${index}">${expandedPlanIndex === index ? 'Done' : 'Edit'}</button>
            <button type="button" class="secondary-button" data-duplicate-plan="${index}">Duplicate</button>
            <button type="button" class="ghost-warn" data-remove-plan="${index}">Remove</button>
          </div>
        </div>
        <div class="plan-editor" ${expandedPlanIndex === index ? '' : 'hidden'}>
          <div class="field-grid">
            <label>
              Plan ID
              <input id="plan_id_${index}" value="${escapeHtml(plan.id)}" placeholder="pro_monthly" />
            </label>
            <label>
              Title
              <input id="plan_title_${index}" value="${escapeHtml(plan.title)}" placeholder="Pro monthly" />
            </label>
          </div>
          <div class="field-grid">
            <label>
              Payment rail
              <select id="plan_paymentRail_${index}">
                <option value="evm" ${plan.paymentRail === 'evm' ? 'selected' : ''}>EVM</option>
                <option value="bitcoin" ${plan.paymentRail === 'bitcoin' ? 'selected' : ''}>Bitcoin</option>
              </select>
            </label>
            <label>
              Amount USD
              <input id="plan_amount_${index}" type="number" min="0" step="0.01" value="${Number(plan.amountUsd || 0).toFixed(2)}" />
            </label>
            <label>
              Description
              <input id="plan_description_${index}" value="${escapeHtml(plan.description)}" placeholder="Describe what unlocks after payment" />
            </label>
          </div>
          <div class="field-stack">
            <div>
              <div class="eyebrow">Networks</div>
              <div class="checkbox-grid">
                ${Object.entries(appConfig.chains).filter(([chain]) => chainRail(chain) === plan.paymentRail).map(([chain, chainConfig]) => planCheckboxMarkup({
                  group: `chains_${index}`,
                  value: chain,
                  label: chainConfig.name,
                  checked: (plan.enabledChains || []).includes(chain)
                })).join('')}
              </div>
            </div>
            <div>
              <div class="eyebrow">Accepted assets</div>
              <div class="checkbox-grid">
                ${Object.keys(appConfig.assets).filter((asset) => assetRail(asset) === plan.paymentRail).map((asset) => planCheckboxMarkup({
                  group: `assets_${index}`,
                  value: asset,
                  label: asset,
                  checked: (plan.acceptedAssets || []).includes(asset)
                })).join('')}
              </div>
            </div>
          </div>
        </div>
      </section>
    `).join('')
    : '<div class="muted">No plans configured yet.</div>';

  document.querySelectorAll('[data-toggle-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.togglePlan);
      expandedPlanIndex = expandedPlanIndex === index ? null : index;
      renderPlansEditor(collectPlans());
    });
  });

  document.querySelectorAll('[data-remove-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      merchantPlans.splice(Number(button.dataset.removePlan), 1);
      if (expandedPlanIndex === Number(button.dataset.removePlan)) expandedPlanIndex = null;
      renderPlansEditor(merchantPlans);
    });
  });

  document.querySelectorAll('[data-duplicate-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const source = merchantPlans[Number(button.dataset.duplicatePlan)];
      if (!source) return;
      merchantPlans.splice(Number(button.dataset.duplicatePlan) + 1, 0, {
        ...source,
        id: `${source.id || 'plan'}_${Math.random().toString(36).slice(2, 6)}`
      });
      expandedPlanIndex = Number(button.dataset.duplicatePlan) + 1;
      renderPlansEditor(merchantPlans);
    });
  });

  document.querySelectorAll('[id^="plan_paymentRail_"]').forEach((select) => {
    select.addEventListener('change', () => {
      const index = Number(select.id.replace('plan_paymentRail_', ''));
      const nextRail = normalizePaymentRail(select.value);
      const current = merchantPlans[index];
      if (!current) return;
      merchantPlans[index] = {
        ...current,
        paymentRail: nextRail,
        enabledChains: valuesForRail(current.enabledChains, nextRail, 'chain').length
          ? valuesForRail(current.enabledChains, nextRail, 'chain')
          : defaultRailSelection(nextRail, 'chain'),
        acceptedAssets: valuesForRail(current.acceptedAssets, nextRail, 'asset').length
          ? valuesForRail(current.acceptedAssets, nextRail, 'asset')
          : defaultRailSelection(nextRail, 'asset')
      };
      renderPlansEditor(merchantPlans);
    });
  });

  renderPlanSelect(merchantPlans, activePlanId);
}

function collectPlans() {
  return merchantPlans.map((_plan, index) => ({
    id: document.getElementById(`plan_id_${index}`).value.trim(),
    title: document.getElementById(`plan_title_${index}`).value.trim(),
    description: document.getElementById(`plan_description_${index}`).value.trim(),
    amountUsd: Number(document.getElementById(`plan_amount_${index}`).value || 0),
    paymentRail: normalizePaymentRail(document.getElementById(`plan_paymentRail_${index}`).value),
    enabledChains: [...document.querySelectorAll(`[data-plan-group="chains_${index}"]:checked`)].map((input) => input.value),
    acceptedAssets: [...document.querySelectorAll(`[data-plan-group="assets_${index}"]:checked`)].map((input) => input.value)
  }));
}

function syncCheckoutOverrides() {
  const planId = document.getElementById('checkoutPlanId')?.value || '';
  const details = document.getElementById('checkoutOverrides');
  const help = document.getElementById('checkoutPlanHelp');
  if (details) details.open = !planId;
  if (!help) return;
  help.textContent = planId
    ? 'Stored plan selected. Open custom overrides only if this checkout needs one-off changes.'
    : 'No stored plan selected. Fill the custom overrides below to create a one-off checkout.';
}

function renderCheckoutPlanSummary() {
  const node = document.getElementById('checkoutPlanSummary');
  if (!node) return;
  const planId = document.getElementById('checkoutPlanId')?.value || '';
  const plan = merchantPlans.find((entry) => entry.id === planId);
  if (!plan) {
    node.hidden = true;
    node.innerHTML = '';
    return;
  }
  node.hidden = false;
  node.innerHTML = `
    <span class="badge ok">Using stored plan</span>
    <strong>${escapeHtml(plan.title || plan.id)}</strong>
    <span class="muted">${railLabel(plan.paymentRail)} · ${formatUsd(plan.amountUsd)} · ${escapeHtml((plan.acceptedAssets || []).join(' · ') || 'No assets')} · ${escapeHtml((plan.enabledChains || []).map((chain) => chainLabel(chain)).join(' · ') || 'No networks')}</span>
  `;
}

function applySelectedPlanToCheckoutForm() {
  const planId = document.getElementById('checkoutPlanId').value;
  const plan = merchantPlans.find((entry) => entry.id === planId);
  syncCheckoutOverrides();
  renderCheckoutPlanSummary();
  if (!plan) return;
  document.getElementById('checkoutTitle').value = plan.title || '';
  document.getElementById('checkoutDescription').value = plan.description || '';
  document.getElementById('checkoutAmountUsd').value = Number(plan.amountUsd || 0).toFixed(2);
  document.getElementById('checkoutPaymentRail').value = normalizePaymentRail(plan.paymentRail);
  syncCheckoutRailSelections({ preferredChains: plan.enabledChains || [], preferredAssets: plan.acceptedAssets || [] });
}

function renderOptionGroups(config) {
  const chainsMarkup = Object.entries(config.chains)
    .map(([chain, chainConfig]) => checkboxMarkup('chain', chain, chainConfig.name))
    .join('');
  const assetsMarkup = Object.keys(config.assets)
    .map((asset) => checkboxMarkup('asset', asset, asset))
    .join('');

  document.getElementById('merchantChains').innerHTML = chainsMarkup;
  document.getElementById('merchantAssets').innerHTML = assetsMarkup;
  document.getElementById('checkoutChains').innerHTML = chainsMarkup;
  document.getElementById('checkoutAssets').innerHTML = assetsMarkup;

  document.getElementById('merchantChainSettings').innerHTML = Object.entries(config.chains).map(([chain, chainConfig], index) => `
    <details class="chain-setting-card" ${index === 0 ? 'open' : ''}>
      <summary>
        <div class="chain-setting-summary">
          <strong>${chainConfig.name}</strong>
          <span class="muted">Receiving address and manual pay toggle</span>
        </div>
        <span class="badge">Edit</span>
      </summary>
      <div class="chain-setting-body field-stack">
        <label>
          Receiving address
          <input id="recipient_${chain}" placeholder="${chain === 'bitcoin' ? 'bc1...' : '0x...'}" />
        </label>
        <label class="checkbox-pill">
          <input id="manualEnabled_${chain}" type="checkbox" />
          <span>Enable manual pay on ${chainConfig.name}</span>
        </label>
      </div>
    </details>
  `).join('');
  renderManualEngineStatus(config);
}

function checkoutPaymentRail() {
  return normalizePaymentRail(document.getElementById('checkoutPaymentRail')?.value || 'evm');
}

function merchantRailDefaults(rail) {
  const merchant = dashboardState?.merchant || {};
  return {
    chains: valuesForRail(merchant.enabledChains || [], rail, 'chain'),
    assets: valuesForRail(merchant.defaultAcceptedAssets || [], rail, 'asset')
  };
}

function syncCheckoutRailSelections({ preferredChains = null, preferredAssets = null } = {}) {
  const rail = checkoutPaymentRail();
  const defaults = merchantRailDefaults(rail);
  const fallbackChains = preferredChains || (defaults.chains.length ? defaults.chains : defaultRailSelection(rail, 'chain'));
  const fallbackAssets = preferredAssets || (defaults.assets.length ? defaults.assets : defaultRailSelection(rail, 'asset'));
  syncRailCheckboxGroup('checkoutChains', rail, 'chain', fallbackChains);
  syncRailCheckboxGroup('checkoutAssets', rail, 'asset', fallbackAssets);
}

function renderStats(data) {
  const payments = merchantPayments(data);
  const pending = data.checkouts.filter((checkout) => checkout.status !== 'paid').length;
  const paid = payments.filter((payment) => payment.status === 'confirmed').length;
  const volume = payments
    .filter((payment) => payment.status === 'confirmed')
    .reduce((sum, payment) => sum + Number(payment.checkout?.amountUsd || 0), 0);
  document.getElementById('statsGrid').innerHTML = `
    <article class="card stat-card">
      <span class="eyebrow">Open checkouts</span>
      <div class="stat-value">${pending}</div>
    </article>
    <article class="card stat-card">
      <span class="eyebrow">Confirmed payments</span>
      <div class="stat-value">${paid}</div>
    </article>
    <article class="card stat-card">
      <span class="eyebrow">USD processed</span>
      <div class="stat-value">${formatUsd(volume)}</div>
    </article>
  `;
}

function setupChecklistItems(data) {
  const merchant = data.merchant || {};
  const plans = merchant.plans || [];
  const enabledChains = merchant.enabledChains || [];
  const configuredRecipients = enabledChains.filter((chain) => merchantSettlementConfigured(merchant, chain)).length;
  const confirmedPayments = merchantPayments(data).filter((payment) => payment.status === 'confirmed').length;
  return [
    {
      label: 'Brand ready',
      detail: merchant.brandName && merchant.checkoutHeadline ? 'Brand name and checkout copy are set.' : 'Add display name and checkout messaging.',
      ready: Boolean(merchant.brandName && merchant.checkoutHeadline),
      section: 'brand'
    },
    {
      label: 'Operations ready',
      detail: merchant.webhookUrl && configuredRecipients === enabledChains.length
        ? 'Webhook and settlement addresses are configured.'
        : 'Finish webhook setup and add a receiving address for each enabled chain.',
      ready: Boolean(merchant.webhookUrl && enabledChains.length && configuredRecipients === enabledChains.length),
      section: 'settings'
    },
    {
      label: 'Plans ready',
      detail: plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'} available for checkout creation.` : 'Create at least one plan for the normal purchase flow.',
      ready: plans.length > 0,
      section: 'plans'
    },
    {
      label: 'Payments live',
      detail: confirmedPayments ? `${confirmedPayments} confirmed payment${confirmedPayments === 1 ? '' : 's'} recorded.` : 'No confirmed payments yet.',
      ready: confirmedPayments > 0,
      section: 'payments'
    }
  ];
}

function renderNavSummary(data) {
  const node = document.getElementById('dashboardNavSummary');
  if (!node) return;
  const merchant = data.merchant || {};
  const checklist = setupChecklistItems(data);
  const completed = checklist.filter((item) => item.ready).length;
  node.innerHTML = `
    <strong>${escapeHtml(merchant.brandName || merchant.name || 'Merchant')}</strong>
    <span class="muted">${completed}/${checklist.length} setup areas in good shape</span>
    <div class="dashboard-nav-pills">
      ${checklist.map((item) => `<span class="badge ${item.ready ? 'ok' : 'warn'}">${escapeHtml(item.label)}</span>`).join('')}
    </div>
  `;
}

function renderOperationsSummary(data) {
  const node = document.getElementById('operationsSummaryCard');
  if (!node) return;
  const merchant = data.merchant || {};
  const enabledChains = merchant.enabledChains || [];
  const configuredRecipients = enabledChains.filter((chain) => merchantSettlementConfigured(merchant, chain));
  const manualEnabled = merchant.manualPaymentEnabledChains || [];
  const webhookReady = Boolean(merchant.webhookUrl);
  node.innerHTML = `
    <span class="badge ${webhookReady ? 'ok' : 'warn'}">${webhookReady ? 'Webhook ready' : 'Webhook missing'}</span>
    <span class="muted">${configuredRecipients.length}/${enabledChains.length || 0} enabled networks have receiving addresses configured.</span>
    <span class="muted">${manualEnabled.length} network${manualEnabled.length === 1 ? '' : 's'} currently allow manual pay.</span>
  `;
}

function renderOverview(data) {
  const merchant = data.merchant || {};
  const payments = merchantPayments(data);
  const confirmedPayments = payments.filter((payment) => payment.status === 'confirmed');
  const plans = merchant.plans || [];
  const checklist = setupChecklistItems(data);
  document.getElementById('overviewCards').innerHTML = `
    <article class="overview-card">
      <span class="eyebrow">Brand</span>
      <strong>${escapeHtml(merchant.brandName || merchant.name || 'Merchant')}</strong>
      <p class="muted">${escapeHtml(merchant.checkoutHeadline || 'No checkout headline configured yet.')}</p>
      <button type="button" class="secondary-button" data-open-section="brand">Open brand</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Webhooks & settlement</span>
      <strong>${merchant.webhookUrl ? 'Webhook configured' : 'Configure operations'}</strong>
      <p class="muted">${escapeHtml(merchant.webhookUrl || 'No webhook configured yet.')}</p>
      <button type="button" class="secondary-button" data-open-section="settings">Open settings</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Plans</span>
      <strong>${plans.length} stored plan${plans.length === 1 ? '' : 's'}</strong>
      <p class="muted">${escapeHtml(plans.slice(0, 3).map((plan) => `${plan.title} ${formatUsd(plan.amountUsd)}`).join(' · ') || 'Create the first plan.')}</p>
      <button type="button" class="secondary-button" data-open-section="plans">Manage plans</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Payments</span>
      <strong>${confirmedPayments.length} confirmed</strong>
      <p class="muted">${formatUsd(confirmedPayments.reduce((sum, payment) => sum + Number(payment.checkout?.amountUsd || 0), 0))} processed so far.</p>
      <button type="button" class="secondary-button" data-open-section="payments">View payments</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Checkout</span>
      <strong>Create a session</strong>
      <p class="muted">${(merchant.defaultAcceptedAssets || []).join(' · ') || 'Select accepted assets'} across ${(merchant.enabledChains || []).length || 0} network(s).</p>
      <button type="button" class="secondary-button" data-open-section="checkout">New checkout</button>
    </article>
  `;
  document.getElementById('overviewChecklist').innerHTML = checklist.map((item) => `
    <article class="overview-check-card">
      <div class="overview-check-copy">
        <span class="badge ${item.ready ? 'ok' : 'warn'}">${item.ready ? 'Ready' : 'Needs work'}</span>
        <strong>${escapeHtml(item.label)}</strong>
        <p class="muted">${escapeHtml(item.detail)}</p>
      </div>
      <button type="button" class="secondary-button" data-open-section="${item.section}">Open ${escapeHtml(item.section)}</button>
    </article>
  `).join('');
  document.getElementById('overviewCheckoutList').innerHTML = data.checkouts.length
    ? data.checkouts.slice(0, 5).map(checkoutRow).join('')
    : 'No checkouts yet.';
  document.querySelectorAll('[data-open-section]').forEach((button) => {
    button.addEventListener('click', () => setDashboardSection(button.dataset.openSection));
  });
}

function hydrateMerchantForm(merchant) {
  document.getElementById('merchantBrandName').value = merchant.brandName || merchant.name || '';
  document.getElementById('merchantName').value = merchant.name || '';
  document.getElementById('merchantSupportEmail').value = merchant.supportEmail || '';
  document.getElementById('merchantHeadline').value = merchant.checkoutHeadline || '';
  document.getElementById('merchantDescription').value = merchant.checkoutDescription || '';
  document.getElementById('merchantDefaultPaymentRail').value = normalizePaymentRail(merchant.defaultPaymentRail);
  document.getElementById('merchantWebhookUrl').value = merchant.webhookUrl || '';
  document.getElementById('merchantWebhookSecret').value = merchant.webhookSecret || '';
  document.getElementById('merchantLogoUrl').value = merchant.logoUrl || '';
  document.getElementById('merchantBitcoinXpub').value = merchant.bitcoinXpub || '';
  setPreviewLogo(merchant.logoUrl);
  setCheckedValues('merchantChains', merchant.enabledChains || []);
  setCheckedValues('merchantAssets', merchant.defaultAcceptedAssets || ['USDC', 'USDT']);
  renderPlansEditor(merchant.plans || []);

  for (const chain of Object.keys(appConfig.chains)) {
    document.getElementById(`recipient_${chain}`).value = merchant.recipientAddresses?.[chain] || '';
    document.getElementById(`manualEnabled_${chain}`).checked = (merchant.manualPaymentEnabledChains || []).includes(chain);
  }

  document.getElementById('checkoutTitle').value = 'Pro plan';
  document.getElementById('checkoutDescription').value = merchant.checkoutDescription || 'Access unlocks after onchain confirmation.';
  document.getElementById('checkoutAmountUsd').value = '49.00';
  document.getElementById('checkoutPaymentRail').value = normalizePaymentRail(merchant.defaultPaymentRail);
  syncCheckoutRailSelections();
  document.getElementById('checkoutPlanId').value = '';
  syncCheckoutOverrides();
  renderCheckoutPlanSummary();
  renderBrandPreview();
}

function checkoutRow(checkout) {
  const link = `/checkout.html?id=${checkout.id}`;
  const assets = escapeHtml((checkout.acceptedAssets || [checkout.asset]).join(' · '));
  const chains = escapeHtml((checkout.enabledChains || [checkout.defaultChain]).map((chain) => chainLabel(chain)).join(' · '));
  return `
    <div class="checkout-list-item">
      <div class="checkout-list-meta">
        <strong>${escapeHtml(checkout.title || checkout.orderId)}</strong>
        <span class="muted">$${Number(checkout.amountUsd || 0).toFixed(2)} · ${assets}</span>
        <span class="muted">${chains}</span>
      </div>
      <div class="checkout-list-meta" style="text-align:right">
        <span class="badge ${checkout.status === 'paid' ? 'ok' : 'warn'}">${escapeHtml(checkout.status)}</span>
        <a href="${link}" target="_blank">Open checkout</a>
      </div>
    </div>
  `;
}

function paymentRow(payment) {
  const checkout = payment.checkout || {};
  const checkoutLabel = checkout.title || checkout.orderId || payment.checkoutId;
  const txUrl = explorerTx(payment.chain, payment.txHash);
  const txLabel = payment.txHash ? `${payment.txHash.slice(0, 10)}...` : 'manual';
  return `
    <div class="payment-row">
      <div class="payment-cell payment-primary">
        <strong>${escapeHtml(checkoutLabel)}</strong>
        <span class="muted">${escapeHtml(checkout.orderId || payment.checkoutId)}</span>
        <span class="muted">${escapeHtml(payment.walletAddress || 'Wallet not captured')}</span>
      </div>
      <div class="payment-cell">
        <span class="payment-cell-label">Amount</span>
        <strong>${formatUsd(checkout.amountUsd || 0)}</strong>
      </div>
      <div class="payment-cell">
        <span class="payment-cell-label">Route</span>
        <strong>${escapeHtml((payment.asset || '').toUpperCase())} ${payment.chain ? `· ${escapeHtml(chainLabel(payment.chain))}` : ''}</strong>
        <span class="muted">${payment.method === 'manual' ? 'Manual pay' : 'Wallet pay'}</span>
      </div>
      <div class="payment-cell">
        <span class="payment-cell-label">Status</span>
        <span class="badge ${paymentTone(payment.status)}">${escapeHtml(payment.status)}</span>
      </div>
      <div class="payment-cell payment-cell-end">
        <span class="payment-cell-label">${formatDate(payment.createdAt)}</span>
        ${txUrl ? `<a href="${txUrl}" target="_blank">${escapeHtml(txLabel)}</a>` : `<span class="muted">${escapeHtml(txLabel)}</span>`}
      </div>
    </div>
  `;
}

function eventRow(event) {
  return `
    <div class="event-item">
      <div class="event-meta">
        <strong>${escapeHtml(event.type)}</strong>
        <span class="muted">${escapeHtml(event.data?.title || event.data?.orderId || event.checkoutId)}</span>
      </div>
      <span class="muted">${formatDate(event.createdAt)}</span>
    </div>
  `;
}

function deliveryRow(delivery) {
  return `
    <div class="delivery-item">
      <div class="event-meta">
        <strong>${escapeHtml(delivery.status)}</strong>
        <span class="muted">${escapeHtml(delivery.endpoint)}</span>
      </div>
      <span class="muted">${escapeHtml(delivery.responseCode || 'n/a')}</span>
    </div>
  `;
}

function filteredMerchantPayments(data) {
  const payments = merchantPayments(data);
  const search = paymentFilterState.search.trim().toLowerCase();
  const rangeThreshold = paymentFilterState.range === 'all'
    ? 0
    : daysAgo(Number(String(paymentFilterState.range).replace(/\D/g, '') || 30));
  return payments.filter((payment) => {
    if (paymentFilterState.status !== 'all' && payment.status !== paymentFilterState.status) return false;
    if (paymentFilterState.method !== 'all' && payment.method !== paymentFilterState.method) return false;
    if (rangeThreshold && new Date(payment.createdAt).getTime() < rangeThreshold) return false;
    if (!search) return true;
    const checkout = payment.checkout || {};
    const haystack = [
      checkout.title,
      checkout.orderId,
      payment.checkoutId,
      payment.walletAddress,
      payment.txHash,
      payment.asset,
      payment.chain
    ].join(' ').toLowerCase();
    return haystack.includes(search);
  });
}

function renderPayments(data) {
  const payments = merchantPayments(data);
  const filtered = filteredMerchantPayments(data);
  const confirmed = filtered.filter((payment) => payment.status === 'confirmed');
  const filteredVolume = confirmed.reduce((sum, payment) => sum + Number(payment.checkout?.amountUsd || 0), 0);
  document.getElementById('paymentResultsMeta').textContent = `${filtered.length} of ${payments.length} payments · ${formatUsd(filteredVolume)} confirmed volume in view`;
  document.getElementById('paymentList').innerHTML = filtered.length
    ? filtered.map(paymentRow).join('')
    : 'No payments match the current filters.';
}

function renderDashboard(data) {
  dashboardState = data;
  renderStats(data);
  renderNavSummary(data);
  renderOperationsSummary(data);
  renderOverview(data);
  hydrateMerchantForm(data.merchant);
  renderPayments(data);
  document.getElementById('checkoutList').innerHTML = data.checkouts.length ? data.checkouts.map(checkoutRow).join('') : 'No checkouts yet.';
  document.getElementById('eventList').innerHTML = data.events.length ? data.events.map(eventRow).join('') : 'No events yet.';
  document.getElementById('deliveryList').innerHTML = data.webhookDeliveries.length ? data.webhookDeliveries.map(deliveryRow).join('') : 'No deliveries yet.';
}

async function loadDashboard() {
  const data = await getJson(`/api/dashboard?merchantId=${merchantId}`);
  renderDashboard(data);
  return data;
}

async function unlockDashboard(event) {
  event.preventDefault();
  dashboardToken = document.getElementById('dashboardAuthToken').value.trim();
  if (dashboardToken) localStorage.setItem(dashboardTokenStorageKey, dashboardToken);
  setEditingEnabled(false, 'Checking token…');
  const data = await loadDashboard();
  if (!data?.authenticated) {
    dashboardToken = '';
    localStorage.removeItem(dashboardTokenStorageKey);
    setEditingEnabled(false, 'Invalid dashboard token.');
    return;
  }
  document.getElementById('dashboardAuthToken').value = '';
  setEditingEnabled(true);
}

function collectRecipientAddresses() {
  const out = {};
  for (const chain of Object.keys(appConfig.chains)) {
    const value = document.getElementById(`recipient_${chain}`).value.trim();
    if (value) out[chain] = value;
  }
  return out;
}

function collectManualPaymentEnabledChains() {
  return Object.keys(appConfig.chains).filter((chain) => document.getElementById(`manualEnabled_${chain}`).checked);
}

async function saveMerchant(event) {
  event.preventDefault();
  const payload = {
    name: document.getElementById('merchantName').value.trim(),
    brandName: document.getElementById('merchantBrandName').value.trim(),
    supportEmail: document.getElementById('merchantSupportEmail').value.trim(),
    checkoutHeadline: document.getElementById('merchantHeadline').value.trim(),
    checkoutDescription: document.getElementById('merchantDescription').value.trim(),
    defaultPaymentRail: normalizePaymentRail(document.getElementById('merchantDefaultPaymentRail').value),
    webhookUrl: document.getElementById('merchantWebhookUrl').value.trim(),
    webhookSecret: document.getElementById('merchantWebhookSecret').value.trim(),
    bitcoinXpub: document.getElementById('merchantBitcoinXpub').value.trim(),
    logoUrl: uploadedLogoDataUrl || document.getElementById('merchantLogoUrl').value.trim(),
    enabledChains: readCheckedValues('merchantChains'),
    defaultAcceptedAssets: readCheckedValues('merchantAssets'),
    plans: collectPlans(),
    recipientAddresses: collectRecipientAddresses(),
    manualPaymentEnabledChains: collectManualPaymentEnabledChains()
  };

  setMerchantStatus('Saving merchant settings…');
  await getJson(`/api/merchants/${merchantId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  setMerchantStatus('Saved.');
  uploadedLogoDataUrl = '';
  await loadDashboard();
}

function checkoutPayload() {
  return {
    merchantId,
    planId: document.getElementById('checkoutPlanId').value.trim() || undefined,
    title: document.getElementById('checkoutTitle').value.trim(),
    description: document.getElementById('checkoutDescription').value.trim(),
    paymentRail: checkoutPaymentRail(),
    orderId: document.getElementById('checkoutOrderId').value.trim() || undefined,
    amountUsd: Number(document.getElementById('checkoutAmountUsd').value || 0),
    referenceId: document.getElementById('checkoutReferenceId').value.trim() || undefined,
    successUrl: document.getElementById('checkoutSuccessUrl').value.trim() || undefined,
    cancelUrl: document.getElementById('checkoutCancelUrl').value.trim() || undefined,
    enabledChains: readCheckedValues('checkoutChains'),
    acceptedAssets: readCheckedValues('checkoutAssets')
  };
}

function showCreatedCheckout(created) {
  document.getElementById('createdCheckout').innerHTML = `
    <div class="dashboard-inline-result">
      <span class="badge ok">${created.resolved ? 'Resolved via webhook' : 'Checkout created'}</span>
      <a href="${created.checkoutUrl}" target="_blank">${created.checkoutUrl}</a>
      <span class="muted">${escapeHtml(created.checkout.title || created.checkout.orderId)} · ${railLabel(created.checkout.paymentRail)} · ${formatUsd(created.checkout.amountUsd)}</span>
    </div>
  `;
}

function exportPayments() {
  if (!dashboardState) return;
  const rows = filteredMerchantPayments(dashboardState);
  if (!rows.length) {
    document.getElementById('paymentList').textContent = 'No payments available to export.';
    return;
  }

  const header = ['payment_id', 'created_at', 'status', 'method', 'order_id', 'title', 'amount_usd', 'asset', 'chain', 'wallet_address', 'tx_hash', 'recipient_address'];
  const csvRows = rows.map((payment) => [
    payment.id,
    payment.createdAt,
    payment.status,
    payment.method,
    payment.checkout?.orderId || '',
    payment.checkout?.title || '',
    String(payment.checkout?.amountUsd || 0),
    payment.asset || '',
    payment.chain || '',
    payment.walletAddress || '',
    payment.txHash || '',
    payment.recipientAddress || ''
  ]);

  const csv = [header].concat(csvRows).map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `charge-with-crypto-payments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function createCheckout({ resolved }) {
  const payload = checkoutPayload();
  const url = resolved ? '/api/checkouts/resolve' : '/api/checkouts';
  const created = await getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(payload)
  });
  showCreatedCheckout(created);
  await loadDashboard();
}

function bindLogoUpload() {
  document.getElementById('merchantLogoFile').addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      uploadedLogoDataUrl = String(reader.result || '');
      setPreviewLogo(uploadedLogoDataUrl);
      document.getElementById('merchantLogoUrl').value = uploadedLogoDataUrl;
      renderBrandPreview();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('merchantLogoUrl').addEventListener('input', (event) => {
    const value = event.target.value.trim();
    setPreviewLogo(value);
    renderBrandPreview();
  });

  ['merchantBrandName', 'merchantName', 'merchantHeadline', 'merchantDescription'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => renderBrandPreview());
  });
}

function syncPaymentFilters() {
  paymentFilterState = {
    search: document.getElementById('paymentSearchInput').value || '',
    status: document.getElementById('paymentStatusFilter').value || 'all',
    method: document.getElementById('paymentMethodFilter').value || 'all',
    range: document.getElementById('paymentRangeFilter').value || '30d'
  };
  if (dashboardState) renderPayments(dashboardState);
}

document.getElementById('addPlanBtn').addEventListener('click', () => {
  merchantPlans.push(newPlan());
  expandedPlanIndex = merchantPlans.length - 1;
  renderPlansEditor(merchantPlans);
});

document.querySelectorAll('[data-dashboard-section]').forEach((button) => {
  button.addEventListener('click', () => setDashboardSection(button.dataset.dashboardSection));
});

document.getElementById('checkoutPlanId').addEventListener('change', () => applySelectedPlanToCheckoutForm());
document.getElementById('checkoutPaymentRail').addEventListener('change', () => syncCheckoutRailSelections());
document.getElementById('exportPaymentsBtn').addEventListener('click', () => exportPayments());
document.getElementById('paymentSearchInput').addEventListener('input', () => syncPaymentFilters());
document.getElementById('paymentStatusFilter').addEventListener('change', () => syncPaymentFilters());
document.getElementById('paymentMethodFilter').addEventListener('change', () => syncPaymentFilters());
document.getElementById('paymentRangeFilter').addEventListener('change', () => syncPaymentFilters());

document.getElementById('merchantForm').addEventListener('submit', (event) => saveMerchant(event).catch((err) => {
  document.getElementById('merchantSaveStatus').textContent = err.message;
}));

document.getElementById('checkoutForm').addEventListener('submit', (event) => {
  event.preventDefault();
  createCheckout({ resolved: false }).catch((err) => {
    document.getElementById('createdCheckout').textContent = err.message;
  });
});

document.getElementById('resolveCheckoutBtn').addEventListener('click', () => {
  createCheckout({ resolved: true }).catch((err) => {
    document.getElementById('createdCheckout').textContent = err.message;
  });
});

document.getElementById('dashboardAuthForm').addEventListener('submit', (event) => unlockDashboard(event).catch((err) => {
  dashboardToken = '';
  localStorage.removeItem(dashboardTokenStorageKey);
  setEditingEnabled(false, err.message);
}));

(async function init() {
  appConfig = await getJson('/api/config');
  renderOptionGroups(appConfig);
  bindLogoUpload();
  syncPaymentFilters();
  try {
    const data = await loadDashboard();
    if (!data?.authenticated && dashboardToken) {
      dashboardToken = '';
      localStorage.removeItem(dashboardTokenStorageKey);
    }
    if (data?.authenticated || !appConfig.dashboardAuthConfigured) {
      setEditingEnabled(true);
    } else {
      setEditingEnabled(false, 'Enter dashboard token to edit.');
    }
  } catch (err) {
    throw err;
  }
  setDashboardSection((window.location.hash || '#overview').slice(1), { syncHash: false });
})();
