import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { fetchJson, jsonRequest, withDashboardToken } from '../../lib/browser/api';
import {
  assetRail,
  chainLabel,
  chainRail,
  createCheckoutDraft,
  createMerchantDraft,
  dashboardTokenStorageKey,
  defaultMerchantLogo,
  defaultRailSelection,
  explorerTx,
  filteredMerchantPayments,
  formatDate,
  formatUsd,
  merchantPayments,
  merchantSettlementConfigured,
  newPlan,
  normalizePaymentRail,
  paymentTone,
  railLabel,
  runItems,
  setupItems,
  valuesForRail,
  type DashboardSection,
  type PaymentFilterState
} from './dashboard.shared';

function LogoImage({ alt, src, className }: { alt: string; src: string; className?: string }) {
  const [currentSrc, setCurrentSrc] = useState(src || defaultMerchantLogo);

  useEffect(() => {
    setCurrentSrc(src || defaultMerchantLogo);
  }, [src]);

  return <img alt={alt} className={className} src={currentSrc} onError={() => setCurrentSrc(defaultMerchantLogo)} />;
}

type DashboardPageProps = {
  merchantId: string;
  appConfig: any;
  initialData: any;
};

export function DashboardPage({ merchantId, appConfig, initialData }: DashboardPageProps) {
  const [dashboardData, setDashboardData] = useState(initialData);
  const [dashboardToken, setDashboardToken] = useState('');
  const [authInput, setAuthInput] = useState('');
  const [activeSection, setActiveSection] = useState<DashboardSection>('overview');
  const [merchantDraft, setMerchantDraft] = useState(() => createMerchantDraft(initialData?.merchant, appConfig));
  const [checkoutDraft, setCheckoutDraft] = useState(() => createCheckoutDraft(initialData?.merchant, appConfig));
  const [createdCheckout, setCreatedCheckout] = useState<any>(null);
  const [merchantStatus, setMerchantStatus] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [expandedPlanIndex, setExpandedPlanIndex] = useState<number | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilterState>({
    search: '',
    status: 'all',
    method: 'all',
    range: '30d'
  });
  const deferredSearch = useDeferredValue(paymentFilter.search);

  useEffect(() => {
    document.body.classList.add('dashboard-page');
    return () => document.body.classList.remove('dashboard-page');
  }, []);

  useEffect(() => {
    setDashboardData(initialData);
    setMerchantDraft(createMerchantDraft(initialData?.merchant, appConfig));
    setCheckoutDraft(createCheckoutDraft(initialData?.merchant, appConfig));
  }, [initialData, appConfig]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextSection = (window.location.hash || '#overview').slice(1) as DashboardSection;
    if (nextSection) setActiveSection(isDashboardSection(nextSection) ? nextSection : 'overview');
    const onHashChange = () => {
      const section = (window.location.hash || '#overview').slice(1) as DashboardSection;
      setActiveSection(isDashboardSection(section) ? section : 'overview');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.hash = activeSection;
    window.history.replaceState({}, '', url.toString());
  }, [activeSection]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(dashboardTokenStorageKey) || '';
    if (!stored) return;
    setDashboardToken(stored);
    if (appConfig?.dashboardAuthConfigured && !dashboardData?.authenticated) {
      void reloadDashboard(stored);
    }
  }, [appConfig?.dashboardAuthConfigured, dashboardData?.authenticated]);

  const editingEnabled = dashboardData?.authenticated || !appConfig?.dashboardAuthConfigured;
  const payments = useMemo(() => merchantPayments(dashboardData), [dashboardData]);
  const filteredPayments = useMemo(
    () => filteredMerchantPayments(dashboardData, { ...paymentFilter, search: deferredSearch }),
    [dashboardData, paymentFilter, deferredSearch]
  );

  const confirmedPayments = filteredPayments.filter((payment: any) => payment.status === 'confirmed');
  const filteredVolume = confirmedPayments.reduce((sum: number, payment: any) => sum + Number(payment.checkout?.amountUsd || 0), 0);
  const totalConfirmedVolume = payments
    .filter((payment: any) => payment.status === 'confirmed')
    .reduce((sum: number, payment: any) => sum + Number(payment.checkout?.amountUsd || 0), 0);
  const openCheckouts = (dashboardData?.checkouts || []).filter((checkout: any) => checkout.status !== 'paid').length;

  const checklist = useMemo(() => {
    const merchant = dashboardData?.merchant || {};
    const plans = merchant.plans || [];
    const enabledChains = merchant.enabledChains || [];
    const configuredRecipients = enabledChains.filter((chain: string) => merchantSettlementConfigured(merchant, chain)).length;
    const confirmedCount = payments.filter((payment: any) => payment.status === 'confirmed').length;
    return [
      {
        label: 'Brand ready',
        detail: merchant.brandName && merchant.checkoutHeadline ? 'Brand name and checkout copy are set.' : 'Add display name and checkout messaging.',
        ready: Boolean(merchant.brandName && merchant.checkoutHeadline),
        section: 'brand' as DashboardSection
      },
      {
        label: 'Operations ready',
        detail: merchant.webhookUrl && enabledChains.length && configuredRecipients === enabledChains.length
          ? 'Webhook and settlement addresses are configured.'
          : 'Finish webhook setup and add a receiving address for each enabled chain.',
        ready: Boolean(merchant.webhookUrl && enabledChains.length && configuredRecipients === enabledChains.length),
        section: 'settings' as DashboardSection
      },
      {
        label: 'Plans ready',
        detail: plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'} available for checkout creation.` : 'Create at least one plan for the normal purchase flow.',
        ready: plans.length > 0,
        section: 'plans' as DashboardSection
      },
      {
        label: 'Payments live',
        detail: confirmedCount ? `${confirmedCount} confirmed payment${confirmedCount === 1 ? '' : 's'} recorded.` : 'No confirmed payments yet.',
        ready: confirmedCount > 0,
        section: 'payments' as DashboardSection
      }
    ];
  }, [dashboardData, payments]);

  async function reloadDashboard(tokenOverride = dashboardToken) {
    const data = await fetchJson<any>(
      `/api/dashboard?merchantId=${encodeURIComponent(merchantId)}`,
      withDashboardToken(undefined, tokenOverride)
    );
    setDashboardData(data);
    setMerchantDraft(createMerchantDraft(data?.merchant, appConfig));
    setCheckoutDraft(createCheckoutDraft(data?.merchant, appConfig));
    setCreatedCheckout(null);

    if (!data?.authenticated && tokenOverride) {
      setDashboardToken('');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(dashboardTokenStorageKey);
      }
    }

    return data;
  }

  function setMerchantField(field: string, value: any) {
    setMerchantDraft((current: any) => ({ ...current, [field]: value }));
  }

  function setCheckoutField(field: string, value: any) {
    setCheckoutDraft((current: any) => ({ ...current, [field]: value }));
  }

  function updatePlan(index: number, patch: Record<string, any>) {
    setMerchantDraft((current: any) => {
      const plans = [...current.plans];
      plans[index] = { ...plans[index], ...patch };
      return { ...current, plans };
    });
  }

  function setPlanRail(index: number, nextRail: string) {
    const plan = merchantDraft.plans[index];
    if (!plan) return;
    const enabledChains = valuesForRail(plan.enabledChains, nextRail, 'chain');
    const acceptedAssets = valuesForRail(plan.acceptedAssets, nextRail, 'asset');
    updatePlan(index, {
      paymentRail: nextRail,
      enabledChains: enabledChains.length ? enabledChains : defaultRailSelection(appConfig, nextRail, 'chain'),
      acceptedAssets: acceptedAssets.length ? acceptedAssets : defaultRailSelection(appConfig, nextRail, 'asset')
    });
  }

  function toggleStringValue(values: string[], value: string, checked: boolean) {
    if (checked) return values.includes(value) ? values : [...values, value];
    return values.filter((entry) => entry !== value);
  }

  function syncCheckoutRail(nextRail: string) {
    const merchantChainDefaults = valuesForRail(merchantDraft.enabledChains, nextRail, 'chain');
    const merchantAssetDefaults = valuesForRail(merchantDraft.defaultAcceptedAssets, nextRail, 'asset');
    setCheckoutDraft((current: any) => {
      const enabledChains = valuesForRail(current.enabledChains, nextRail, 'chain');
      const acceptedAssets = valuesForRail(current.acceptedAssets, nextRail, 'asset');
      return {
        ...current,
        paymentRail: nextRail,
        enabledChains: enabledChains.length
          ? enabledChains
          : merchantChainDefaults.length
            ? merchantChainDefaults
            : defaultRailSelection(appConfig, nextRail, 'chain'),
        acceptedAssets: acceptedAssets.length
          ? acceptedAssets
          : merchantAssetDefaults.length
            ? merchantAssetDefaults
            : defaultRailSelection(appConfig, nextRail, 'asset')
      };
    });
  }

  function applySelectedPlan(planId: string) {
    const plan = merchantDraft.plans.find((entry: any) => entry.id === planId);
    setCheckoutDraft((current: any) => {
      if (!plan) return { ...current, planId };
      return {
        ...current,
        planId,
        title: plan.title || '',
        description: plan.description || '',
        paymentRail: normalizePaymentRail(plan.paymentRail),
        amountUsd: Number(plan.amountUsd || 0).toFixed(2),
        enabledChains: plan.enabledChains || [],
        acceptedAssets: plan.acceptedAssets || []
      };
    });
  }

  async function handleUnlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextToken = authInput.trim();
    setAuthStatus('Checking token…');
    setDashboardToken(nextToken);
    if (typeof window !== 'undefined') {
      if (nextToken) window.localStorage.setItem(dashboardTokenStorageKey, nextToken);
      else window.localStorage.removeItem(dashboardTokenStorageKey);
    }

    const data = await reloadDashboard(nextToken);
    if (!data?.authenticated) {
      setAuthStatus('Invalid dashboard token.');
      setDashboardToken('');
      setAuthInput('');
      return;
    }
    setAuthInput('');
    setAuthStatus('');
  }

  async function handleSaveMerchant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMerchantStatus('Saving merchant settings…');
    const payload = {
      ...merchantDraft,
      plans: merchantDraft.plans.map((plan: any) => ({
        ...plan,
        amountUsd: Number(plan.amountUsd || 0)
      }))
    };

    await fetchJson(
      `/api/merchants/${encodeURIComponent(merchantId)}`,
      withDashboardToken(
        jsonRequest(payload, {
          method: 'PATCH'
        }),
        dashboardToken
      )
    );

    setMerchantStatus('Saved.');
    await reloadDashboard(dashboardToken);
  }

  async function handleCreateCheckout(resolved: boolean) {
    const payload = {
      merchantId,
      planId: checkoutDraft.planId || undefined,
      title: checkoutDraft.title || undefined,
      description: checkoutDraft.description || undefined,
      paymentRail: checkoutDraft.paymentRail,
      orderId: checkoutDraft.orderId || undefined,
      amountUsd: Number(checkoutDraft.amountUsd || 0),
      referenceId: checkoutDraft.referenceId || undefined,
      successUrl: checkoutDraft.successUrl || undefined,
      cancelUrl: checkoutDraft.cancelUrl || undefined,
      enabledChains: checkoutDraft.enabledChains,
      acceptedAssets: checkoutDraft.acceptedAssets
    };

    const created = await fetchJson<any>(
      resolved ? '/api/checkouts/resolve' : '/api/checkouts',
      withDashboardToken(
        jsonRequest(payload, {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() }
        }),
        dashboardToken
      )
    );
    setCreatedCheckout(created);
    await reloadDashboard(dashboardToken);
  }

  function handleExportPayments() {
    if (!filteredPayments.length) return;
    const header = ['payment_id', 'created_at', 'status', 'method', 'order_id', 'title', 'amount_usd', 'asset', 'chain', 'wallet_address', 'tx_hash', 'recipient_address'];
    const csvRows = filteredPayments.map((payment: any) => [
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

    const csv = [header]
      .concat(csvRows)
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
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

  function handleLogoUpload(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setMerchantDraft((current: any) => ({ ...current, logoUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  const merchant = dashboardData?.merchant || {};
  const completedSetup = checklist.filter((item) => item.ready).length;
  const operationsConfigured = (merchant.enabledChains || []).filter((chain: string) => merchantSettlementConfigured(merchant, chain)).length;
  const locked = Boolean(appConfig?.dashboardAuthConfigured && !dashboardData?.authenticated);

  return (
    <>
      <div className="atmosphere atmosphere-a"></div>
      <div className="atmosphere atmosphere-b"></div>

      <main className="dashboard-shell">
        {locked ? (
          <>
            <section className="card dashboard-topbar">
              <div className="stack-sm">
                <span className="eyebrow">Charge With Crypto</span>
                <h1>Merchant dashboard</h1>
                <p className="muted">Enter the configured dashboard token to load merchant settings, plans, checkouts, products, and payments.</p>
              </div>
              <div className="dashboard-actions">
                <a className="link-button" href="/">Home</a>
              </div>
            </section>

            <section className="card dashboard-topbar">
              <div className="stack-sm">
                <span className="eyebrow">Access required</span>
                <h2>Enter dashboard token</h2>
                <p className="muted">This dashboard does not expose a public read-only mode.</p>
              </div>
              <form className="dashboard-auth-form" onSubmit={handleUnlock}>
                <label>
                  Dashboard token
                  <input
                    placeholder="dashboard token"
                    type="password"
                    value={authInput}
                    onChange={(event) => setAuthInput(event.target.value)}
                  />
                </label>
                <button className="primary-button" type="submit">Unlock dashboard</button>
                <div className="muted">{authStatus}</div>
              </form>
            </section>
          </>
        ) : (
          <>
        {!editingEnabled && appConfig?.dashboardAuthConfigured ? (
          <section className="card dashboard-topbar">
            <div className="stack-sm">
              <span className="eyebrow">Editing locked</span>
              <h1>Enter dashboard token to edit</h1>
              <p className="muted">Enter the configured token to enable merchant edits from this browser.</p>
            </div>
            <form className="dashboard-auth-form" onSubmit={handleUnlock}>
              <label>
                Dashboard token
                <input
                  placeholder="dashboard token"
                  type="password"
                  value={authInput}
                  onChange={(event) => setAuthInput(event.target.value)}
                />
              </label>
              <button className="primary-button" type="submit">Unlock dashboard</button>
              <div className="muted">{authStatus}</div>
            </form>
          </section>
        ) : null}

        <section className="card dashboard-topbar">
          <div className="stack-sm">
            <span className="eyebrow">Charge With Crypto</span>
            <h1>Merchant dashboard</h1>
            <p className="muted">Use the left menu to manage brand, plans, checkout creation, payments, and activity one section at a time.</p>
          </div>
          <div className="dashboard-actions">
            <a className="link-button" href="/">Home</a>
            <a className="secondary-button" href="/" rel="noreferrer" target="_blank">Open deployed app</a>
          </div>
        </section>

        <section className="dashboard-layout">
          <aside className="card dashboard-nav">
            <div className="dashboard-nav-label">Menu</div>
            <div className="dashboard-nav-summary">
              <strong>{merchant.brandName || merchant.name || 'Merchant'}</strong>
              <span className="muted">{completedSetup}/{checklist.length} setup areas in good shape</span>
              <div className="dashboard-nav-pills">
                {checklist.map((item) => (
                  <span className={`badge ${item.ready ? 'ok' : 'warn'}`} key={item.label}>{item.label}</span>
                ))}
              </div>
            </div>
            <div className="dashboard-nav-section">
              <div className="dashboard-nav-group-label">Setup</div>
              <div className="dashboard-nav-group">
                {setupItems.map(([key, label]) => (
                  <button
                    className={`dashboard-nav-item ${activeSection === key ? 'is-active' : ''}`}
                    key={key}
                    type="button"
                    onClick={() => setActiveSection(key as DashboardSection)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="dashboard-nav-section">
              <div className="dashboard-nav-group-label">Run</div>
              <div className="dashboard-nav-group">
                {runItems.map(([key, label]) => (
                  <button
                    className={`dashboard-nav-item ${activeSection === key ? 'is-active' : ''}`}
                    key={key}
                    type="button"
                    onClick={() => setActiveSection(key as DashboardSection)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="dashboard-main">
            <section className="card dashboard-panel" hidden={activeSection !== 'overview'}>
              <div className="panel-header">
                <span className="eyebrow">Overview</span>
                <h2>Merchant snapshot</h2>
                <p className="muted">The quick view: what is configured, what is active, and where to jump next.</p>
              </div>

              <div className="stats-grid">
                <article className="card stat-card">
                  <span className="eyebrow">Open checkouts</span>
                  <div className="stat-value">{openCheckouts}</div>
                </article>
                <article className="card stat-card">
                  <span className="eyebrow">Confirmed payments</span>
                  <div className="stat-value">{payments.filter((payment: any) => payment.status === 'confirmed').length}</div>
                </article>
                <article className="card stat-card">
                  <span className="eyebrow">USD processed</span>
                  <div className="stat-value">{formatUsd(totalConfirmedVolume)}</div>
                </article>
              </div>

              <div className="overview-grid">
                <article className="overview-card">
                  <span className="eyebrow">Brand</span>
                  <strong>{merchant.brandName || merchant.name || 'Merchant'}</strong>
                  <p className="muted">{merchant.checkoutHeadline || 'No checkout headline configured yet.'}</p>
                  <button className="secondary-button" type="button" onClick={() => setActiveSection('brand')}>Open brand</button>
                </article>
                <article className="overview-card">
                  <span className="eyebrow">Webhooks & settlement</span>
                  <strong>{merchant.webhookUrl ? 'Webhook configured' : 'Configure operations'}</strong>
                  <p className="muted">{merchant.webhookUrl || 'No webhook configured yet.'}</p>
                  <button className="secondary-button" type="button" onClick={() => setActiveSection('settings')}>Open settings</button>
                </article>
                <article className="overview-card">
                  <span className="eyebrow">Plans</span>
                  <strong>{merchant.plans?.length || 0} stored plan{merchant.plans?.length === 1 ? '' : 's'}</strong>
                  <p className="muted">
                    {(merchant.plans || []).slice(0, 3).map((plan: any) => `${plan.title} ${formatUsd(plan.amountUsd)}`).join(' · ') || 'Create the first plan.'}
                  </p>
                  <button className="secondary-button" type="button" onClick={() => setActiveSection('plans')}>Manage plans</button>
                </article>
                <article className="overview-card">
                  <span className="eyebrow">Payments</span>
                  <strong>{payments.filter((payment: any) => payment.status === 'confirmed').length} confirmed</strong>
                  <p className="muted">{formatUsd(totalConfirmedVolume)} processed so far.</p>
                  <button className="secondary-button" type="button" onClick={() => setActiveSection('payments')}>View payments</button>
                </article>
                <article className="overview-card">
                  <span className="eyebrow">Checkout</span>
                  <strong>Create a session</strong>
                  <p className="muted">
                    {(merchant.defaultAcceptedAssets || []).join(' · ') || 'Select accepted assets'} across {(merchant.enabledChains || []).length || 0} network(s).
                  </p>
                  <button className="secondary-button" type="button" onClick={() => setActiveSection('checkout')}>New checkout</button>
                </article>
              </div>

              <div className="overview-checklist">
                {checklist.map((item) => (
                  <article className="overview-check-card" key={item.label}>
                    <div className="overview-check-copy">
                      <span className={`badge ${item.ready ? 'ok' : 'warn'}`}>{item.ready ? 'Ready' : 'Needs work'}</span>
                      <strong>{item.label}</strong>
                      <p className="muted">{item.detail}</p>
                    </div>
                    <button className="secondary-button" type="button" onClick={() => setActiveSection(item.section)}>
                      Open {item.section}
                    </button>
                  </article>
                ))}
              </div>

              <div className="panel-header">
                <span className="eyebrow">Recent</span>
                <h2>Latest checkouts</h2>
              </div>
              <div className="list-stack muted">
                {(dashboardData?.checkouts || []).length ? (dashboardData.checkouts || []).slice(0, 5).map((checkout: any) => (
                  <div className="checkout-list-item" key={checkout.id}>
                    <div className="checkout-list-meta">
                      <strong>{checkout.title || checkout.orderId}</strong>
                      <span className="muted">{formatUsd(checkout.amountUsd)} · {(checkout.acceptedAssets || [checkout.asset]).join(' · ')}</span>
                      <span className="muted">{(checkout.enabledChains || [checkout.defaultChain]).map((chain: string) => chainLabel(appConfig, chain)).join(' · ')}</span>
                    </div>
                    <div className="checkout-list-meta" style={{ textAlign: 'right' }}>
                      <span className={`badge ${checkout.status === 'paid' ? 'ok' : 'warn'}`}>{checkout.status}</span>
                      <a href={`/checkout/${checkout.id}`} target="_blank" rel="noreferrer">Open checkout</a>
                    </div>
                  </div>
                )) : 'No checkouts yet.'}
              </div>
            </section>

            <form className="dashboard-form-wrap" onSubmit={handleSaveMerchant}>
              <fieldset disabled={!editingEnabled} style={{ all: 'unset' as any }}>
                <section className="card dashboard-panel" hidden={activeSection !== 'brand'}>
                  <div className="panel-header">
                    <span className="eyebrow">Brand</span>
                    <h2>Brand and checkout copy</h2>
                    <p className="muted">Manage the customer-facing identity and messaging used in hosted checkout.</p>
                  </div>

                  <div className="field-stack">
                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Identity</span>
                          <h3>Logo and messaging</h3>
                        </div>
                        <div className="helper">What customers see on the checkout page.</div>
                      </div>

                      <div className="settings-columns">
                        <div className="field-stack">
                          <label>
                            Display name
                            <input value={merchantDraft.brandName} onChange={(event) => setMerchantField('brandName', event.target.value)} placeholder="OasisVault" />
                          </label>
                          <label>
                            Checkout headline
                            <input value={merchantDraft.checkoutHeadline} onChange={(event) => setMerchantField('checkoutHeadline', event.target.value)} placeholder="Fast wallet-first crypto checkout" />
                          </label>
                          <label>
                            Checkout description
                            <textarea value={merchantDraft.checkoutDescription} onChange={(event) => setMerchantField('checkoutDescription', event.target.value)} placeholder="Let customers connect a wallet and pay in one confirmation."></textarea>
                          </label>
                          <details className="dashboard-advanced">
                            <summary>Advanced merchant fields</summary>
                            <div className="dashboard-advanced-body">
                              <label>
                                Internal name
                                <input value={merchantDraft.name} onChange={(event) => setMerchantField('name', event.target.value)} placeholder="merchant_demo" />
                              </label>
                              <label>
                                Support email
                                <input value={merchantDraft.supportEmail} onChange={(event) => setMerchantField('supportEmail', event.target.value)} placeholder="payments@example.com" />
                              </label>
                            </div>
                          </details>
                        </div>

                        <div className="field-stack">
                          <div className="logo-uploader">
                            <LogoImage alt="Merchant logo preview" className="logo-preview" src={merchantDraft.logoUrl} />
                            <label>
                              Logo URL or uploaded image
                              <input value={merchantDraft.logoUrl} onChange={(event) => setMerchantField('logoUrl', event.target.value)} placeholder="https://example.com/logo.png" />
                            </label>
                            <label>
                              Upload logo
                              <input accept="image/*" type="file" onChange={(event) => handleLogoUpload(event.target.files?.[0] || null)} />
                            </label>
                            <div className="helper">Uploading stores a data URL so the logo can render directly in the checkout.</div>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Preview</span>
                          <h3>Checkout preview</h3>
                        </div>
                        <div className="helper">See the current merchant identity before saving.</div>
                      </div>
                      <div className="brand-preview-card">
                        <div className="brand-preview-head">
                          <LogoImage
                            alt={`${merchantDraft.brandName || merchantDraft.name || 'Merchant'} logo`}
                            className="summary-logo"
                            src={merchantDraft.logoUrl}
                          />
                          <div className="stack-sm">
                            <span className="eyebrow">Hosted checkout preview</span>
                            <strong>{merchantDraft.brandName || merchantDraft.name || 'Merchant name'}</strong>
                          </div>
                        </div>
                        <div className="brand-preview-copy">
                          <strong>{merchantDraft.checkoutHeadline || 'Fast wallet-first crypto checkout'}</strong>
                          <p className="muted">{merchantDraft.checkoutDescription || 'Customers connect a wallet, get one recommended route, and pay in one confirmation.'}</p>
                        </div>
                      </div>
                    </section>

                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Defaults</span>
                          <h3>Checkout defaults</h3>
                        </div>
                        <div className="helper">Used for direct sessions and as the starting point for stored plans.</div>
                      </div>

                      <div className="field-stack">
                        <label>
                          Default checkout rail
                          <select
                            value={merchantDraft.defaultPaymentRail}
                            onChange={(event) => {
                              const nextRail = normalizePaymentRail(event.target.value);
                              const nextChains = valuesForRail(merchantDraft.enabledChains, nextRail, 'chain');
                              const nextAssets = valuesForRail(merchantDraft.defaultAcceptedAssets, nextRail, 'asset');
                              setMerchantDraft((current: any) => ({
                                ...current,
                                defaultPaymentRail: nextRail,
                                defaultAcceptedAssets: nextAssets.length ? nextAssets : defaultRailSelection(appConfig, nextRail, 'asset')
                              }));
                              if (!nextChains.length) {
                                syncCheckoutRail(nextRail);
                              }
                            }}
                          >
                            <option value="evm">EVM</option>
                            <option value="bitcoin">Bitcoin</option>
                          </select>
                        </label>
                        <div>
                          <div className="eyebrow">Enabled networks</div>
                          <div className="checkbox-grid">
                            {Object.entries(appConfig.chains || {}).map(([chain, chainConfig]: [string, any]) => (
                              <label className="checkbox-pill" key={chain}>
                                <input
                                  checked={merchantDraft.enabledChains.includes(chain)}
                                  type="checkbox"
                                  value={chain}
                                  onChange={(event) => {
                                    const nextEnabledChains = toggleStringValue(merchantDraft.enabledChains, chain, event.target.checked);
                                    setMerchantField('enabledChains', nextEnabledChains);
                                  }}
                                />
                                <span>{chainConfig.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Accepted assets by default</div>
                          <div className="checkbox-grid">
                            {Object.keys(appConfig.assets || {}).map((asset) => (
                              <label className="checkbox-pill" key={asset}>
                                <input
                                  checked={merchantDraft.defaultAcceptedAssets.includes(asset)}
                                  type="checkbox"
                                  value={asset}
                                  onChange={(event) => {
                                    const nextAssets = toggleStringValue(merchantDraft.defaultAcceptedAssets, asset, event.target.checked);
                                    setMerchantField('defaultAcceptedAssets', nextAssets);
                                  }}
                                />
                                <span>{asset}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>

                    <div className="row">
                      <button className="primary-button" type="submit">Save brand settings</button>
                    </div>
                    <div className="muted">{merchantStatus}</div>
                  </div>
                </section>

                <section className="card dashboard-panel" hidden={activeSection !== 'settings'}>
                  <div className="panel-header">
                    <span className="eyebrow">Operations</span>
                    <h2>Webhooks and settlement</h2>
                    <p className="muted">Manage merchant webhook delivery, treasury settlement, and which networks allow manual pay.</p>
                  </div>

                  <div className="field-stack">
                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Readiness</span>
                          <h3>Operations summary</h3>
                        </div>
                        <div className="helper">Use this to spot missing webhook, settlement, or manual-pay setup before going live.</div>
                      </div>
                      <div className="dashboard-inline-result">
                        <span className={`badge ${merchant.webhookUrl ? 'ok' : 'warn'}`}>{merchant.webhookUrl ? 'Webhook ready' : 'Webhook missing'}</span>
                        <span className="muted">{operationsConfigured}/{(merchant.enabledChains || []).length || 0} enabled networks have receiving addresses configured.</span>
                        <span className="muted">{(merchant.manualPaymentEnabledChains || []).length} network{(merchant.manualPaymentEnabledChains || []).length === 1 ? '' : 's'} currently allow manual pay.</span>
                      </div>
                    </section>

                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Webhook</span>
                          <h3>Merchant webhook endpoint</h3>
                        </div>
                        <div className="helper">Charge With Crypto sends both <code>checkout.resolve</code> and <code>payment.confirmed</code> to this endpoint.</div>
                      </div>

                      <div className="field-stack">
                        <label>
                          Webhook URL
                          <input value={merchantDraft.webhookUrl} onChange={(event) => setMerchantField('webhookUrl', event.target.value)} placeholder="https://merchant.app/api/charge-with-crypto" />
                        </label>
                        <label>
                          Webhook secret
                          <input value={merchantDraft.webhookSecret} onChange={(event) => setMerchantField('webhookSecret', event.target.value)} placeholder="whsec_xxx" />
                        </label>
                      </div>
                    </section>

                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Manual pay</span>
                          <h3>Deterministic deposit engine</h3>
                        </div>
                        <div className="helper">Manual pay assigns one derived address per checkout for supported routes and watches settlement automatically.</div>
                      </div>
                      <div className="dashboard-inline-result">
                        {appConfig?.manualPayment?.configured ? (
                          <>
                            <span className="badge ok">Engine configured</span>
                            <span className="muted">
                              EVM {appConfig?.manualPayment?.evm?.derivationMode || 'disabled'} / {appConfig?.manualPayment?.evm?.sweepMode || 'manual'} sweep
                            </span>
                            <span className="muted">Path {appConfig?.manualPayment?.derivationPath}</span>
                            <span className="muted">Sponsor {appConfig?.manualPayment?.sponsorAddress || 'n/a'}</span>
                          </>
                        ) : (
                          <>
                            <span className="badge warn">Server setup required</span>
                            <span className="muted">Set an EVM xpub or signer plus RPC access before enabling manual pay for customers.</span>
                          </>
                        )}
                      </div>
                    </section>

                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Bitcoin</span>
                          <h3>Checkout address derivation</h3>
                        </div>
                        <div className="helper">Add an xpub or zpub if you want one unique Bitcoin receive address per checkout and automatic manual-pay detection.</div>
                      </div>
                      <label>
                        Bitcoin xpub / zpub
                        <input value={merchantDraft.bitcoinXpub} onChange={(event) => setMerchantField('bitcoinXpub', event.target.value)} placeholder="zpub... or xpub..." />
                      </label>
                    </section>

                    <section className="dashboard-form-section">
                      <div className="section-head">
                        <div className="stack-sm">
                          <span className="eyebrow">Settlement</span>
                          <h3>Network routing</h3>
                        </div>
                        <div className="helper">Open a network only when you need to edit receiving addresses or enable manual pay there.</div>
                      </div>
                      <div className="chain-settings-stack">
                        {Object.entries(appConfig.chains || {}).map(([chain, chainConfig]: [string, any], index) => (
                          <details className="chain-setting-card" key={chain} open={index === 0}>
                            <summary>
                              <div className="chain-setting-summary">
                                <strong>{chainConfig.name}</strong>
                                <span className="muted">Receiving address and manual pay toggle</span>
                              </div>
                              <span className="badge">Edit</span>
                            </summary>
                            <div className="chain-setting-body field-stack">
                              <label>
                                Receiving address
                                <input
                                  placeholder={chain === 'bitcoin' ? 'bc1...' : '0x...'}
                                  value={merchantDraft.recipientAddresses?.[chain] || ''}
                                  onChange={(event) => setMerchantDraft((current: any) => ({
                                    ...current,
                                    recipientAddresses: {
                                      ...current.recipientAddresses,
                                      [chain]: event.target.value
                                    }
                                  }))}
                                />
                              </label>
                              <label className="checkbox-pill">
                                <input
                                  checked={merchantDraft.manualPaymentEnabledChains.includes(chain)}
                                  type="checkbox"
                                  onChange={(event) => setMerchantField(
                                    'manualPaymentEnabledChains',
                                    toggleStringValue(merchantDraft.manualPaymentEnabledChains, chain, event.target.checked)
                                  )}
                                />
                                <span>Enable manual pay on {chainConfig.name}</span>
                              </label>
                            </div>
                          </details>
                        ))}
                      </div>
                    </section>

                    <div className="row">
                      <button className="primary-button" type="submit">Save webhooks and settlement</button>
                    </div>
                    <div className="muted">{merchantStatus}</div>
                  </div>
                </section>

                <section className="card dashboard-panel" hidden={activeSection !== 'plans'}>
                  <div className="panel-header panel-header-inline">
                    <div className="stack-sm">
                      <span className="eyebrow">Plans</span>
                      <h2>Stored plans</h2>
                      <p className="muted">Keep plans collapsed until needed. Open one to edit or add a new one.</p>
                    </div>
                    <button className="secondary-button" type="button" onClick={() => {
                      setMerchantDraft((current: any) => ({ ...current, plans: [...current.plans, newPlan(appConfig)] }));
                      setExpandedPlanIndex(merchantDraft.plans.length);
                    }}>Add plan</button>
                  </div>
                  <div className="list-stack">
                    {merchantDraft.plans.length ? merchantDraft.plans.map((plan: any, index: number) => (
                      <section className="card plan-card" key={`${plan.id || 'plan'}-${index}`}>
                        <div className="plan-card-head">
                          <div className="plan-card-summary">
                            <div className="plan-title-row">
                              <strong>{plan.title || `Plan ${index + 1}`}</strong>
                              <span className="badge ok">{formatUsd(plan.amountUsd)}</span>
                              <span className="code">{plan.id || `plan_${index + 1}`}</span>
                            </div>
                            <div className="plan-meta-row">
                              <span className="plan-meta-chip">{railLabel(plan.paymentRail)}</span>
                              <span className="plan-meta-chip">{(plan.enabledChains || []).length} network{(plan.enabledChains || []).length === 1 ? '' : 's'}</span>
                              <span className="plan-meta-chip">{(plan.acceptedAssets || []).join(' · ') || 'No assets selected'}</span>
                              <span className="plan-meta-chip">{plan.description || 'No description yet'}</span>
                            </div>
                          </div>
                          <div className="inline-actions">
                            <button className="secondary-button" type="button" onClick={() => setExpandedPlanIndex(expandedPlanIndex === index ? null : index)}>
                              {expandedPlanIndex === index ? 'Done' : 'Edit'}
                            </button>
                            <button className="secondary-button" type="button" onClick={() => {
                              const duplicate = {
                                ...plan,
                                id: `${plan.id || 'plan'}_${Math.random().toString(36).slice(2, 6)}`
                              };
                              setMerchantDraft((current: any) => {
                                const plans = [...current.plans];
                                plans.splice(index + 1, 0, duplicate);
                                return { ...current, plans };
                              });
                              setExpandedPlanIndex(index + 1);
                            }}>
                              Duplicate
                            </button>
                            <button className="ghost-warn" type="button" onClick={() => {
                              setMerchantDraft((current: any) => ({
                                ...current,
                                plans: current.plans.filter((_: any, planIndex: number) => planIndex !== index)
                              }));
                              setExpandedPlanIndex((current) => (current === index ? null : current != null && current > index ? current - 1 : current));
                            }}>
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="plan-editor" hidden={expandedPlanIndex !== index}>
                          <div className="field-grid">
                            <label>
                              Plan ID
                              <input value={plan.id} onChange={(event) => updatePlan(index, { id: event.target.value })} placeholder="pro_monthly" />
                            </label>
                            <label>
                              Title
                              <input value={plan.title} onChange={(event) => updatePlan(index, { title: event.target.value })} placeholder="Pro monthly" />
                            </label>
                          </div>
                          <div className="field-grid">
                            <label>
                              Payment rail
                              <select value={plan.paymentRail} onChange={(event) => setPlanRail(index, normalizePaymentRail(event.target.value))}>
                                <option value="evm">EVM</option>
                                <option value="bitcoin">Bitcoin</option>
                              </select>
                            </label>
                            <label>
                              Amount USD
                              <input type="number" min="0" step="0.01" value={Number(plan.amountUsd || 0).toFixed(2)} onChange={(event) => updatePlan(index, { amountUsd: Number(event.target.value || 0) })} />
                            </label>
                            <label>
                              Description
                              <input value={plan.description} onChange={(event) => updatePlan(index, { description: event.target.value })} placeholder="Describe what unlocks after payment" />
                            </label>
                          </div>
                          <div className="field-stack">
                            <div>
                              <div className="eyebrow">Networks</div>
                              <div className="checkbox-grid">
                                {Object.entries(appConfig.chains || {})
                                  .filter(([chain]) => chainRail(chain) === plan.paymentRail)
                                  .map(([chain, chainConfig]: [string, any]) => (
                                    <label className="checkbox-pill" key={chain}>
                                      <input
                                        checked={(plan.enabledChains || []).includes(chain)}
                                        type="checkbox"
                                        onChange={(event) => updatePlan(index, {
                                          enabledChains: toggleStringValue(plan.enabledChains || [], chain, event.target.checked)
                                        })}
                                      />
                                      <span>{chainConfig.name}</span>
                                    </label>
                                  ))}
                              </div>
                            </div>
                            <div>
                              <div className="eyebrow">Accepted assets</div>
                              <div className="checkbox-grid">
                                {Object.keys(appConfig.assets || {})
                                  .filter((asset) => assetRail(asset) === plan.paymentRail)
                                  .map((asset) => (
                                    <label className="checkbox-pill" key={asset}>
                                      <input
                                        checked={(plan.acceptedAssets || []).includes(asset)}
                                        type="checkbox"
                                        onChange={(event) => updatePlan(index, {
                                          acceptedAssets: toggleStringValue(plan.acceptedAssets || [], asset, event.target.checked)
                                        })}
                                      />
                                      <span>{asset}</span>
                                    </label>
                                  ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    )) : <div className="muted">No plans configured yet.</div>}
                  </div>
                  <div className="row">
                    <button className="primary-button" type="submit">Save plans</button>
                  </div>
                  <div className="muted">{merchantStatus}</div>
                </section>
              </fieldset>
            </form>

            <section className="card dashboard-panel" hidden={activeSection !== 'checkout'}>
              <div className="panel-header">
                <span className="eyebrow">Checkout</span>
                <h2>Create or resolve a checkout</h2>
                <p className="muted">Most sessions should come from a stored plan. Open custom overrides only when you need a one-off checkout.</p>
              </div>

              <form
                className="field-stack"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await handleCreateCheckout(false);
                }}
              >
                <fieldset disabled={!editingEnabled} style={{ all: 'unset' as any }}>
                  <section className="dashboard-form-section compact-section">
                    <div className="field-grid checkout-plan-grid">
                      <label>
                        Stored plan
                        <select value={checkoutDraft.planId} onChange={(event) => applySelectedPlan(event.target.value)}>
                          <option value="">Custom checkout</option>
                          {merchantDraft.plans.map((plan: any) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.title} ({plan.id})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Order ID
                        <input value={checkoutDraft.orderId} onChange={(event) => setCheckoutField('orderId', event.target.value)} placeholder="order_123" />
                      </label>
                      <label>
                        Reference ID for webhook resolve
                        <input value={checkoutDraft.referenceId} onChange={(event) => setCheckoutField('referenceId', event.target.value)} placeholder="sub_abc123" />
                      </label>
                    </div>
                    <div className="helper">
                      {checkoutDraft.planId
                        ? 'Stored plan selected. Open custom overrides only if this checkout needs one-off changes.'
                        : 'No stored plan selected. Fill the custom overrides below to create a one-off checkout.'}
                    </div>
                    {checkoutDraft.planId ? (
                      <div className="dashboard-inline-result checkout-plan-summary">
                        <span className="badge ok">Using stored plan</span>
                        <strong>{merchantDraft.plans.find((plan: any) => plan.id === checkoutDraft.planId)?.title || checkoutDraft.planId}</strong>
                        <span className="muted">
                          {(() => {
                            const plan = merchantDraft.plans.find((entry: any) => entry.id === checkoutDraft.planId);
                            return plan
                              ? `${railLabel(plan.paymentRail)} · ${formatUsd(plan.amountUsd)} · ${(plan.acceptedAssets || []).join(' · ')} · ${(plan.enabledChains || []).map((chain: string) => chainLabel(appConfig, chain)).join(' · ')}`
                              : '';
                          })()}
                        </span>
                      </div>
                    ) : null}
                  </section>

                  <details className="dashboard-form-section checkout-overrides" open={!checkoutDraft.planId}>
                    <summary>
                      <div className="stack-sm">
                        <span className="eyebrow">Custom overrides</span>
                        <h3>One-off checkout details</h3>
                      </div>
                      <span className="badge">Optional</span>
                    </summary>
                    <div className="checkout-overrides-body">
                      <label>
                        Product or plan title
                        <input value={checkoutDraft.title} onChange={(event) => setCheckoutField('title', event.target.value)} placeholder="Pro plan" />
                      </label>
                      <label>
                        Description
                        <textarea value={checkoutDraft.description} onChange={(event) => setCheckoutField('description', event.target.value)} placeholder="Annual plan with instant access after payment."></textarea>
                      </label>
                      <div className="field-grid">
                        <label>
                          Payment rail
                          <select
                            value={checkoutDraft.paymentRail}
                            onChange={(event) => syncCheckoutRail(normalizePaymentRail(event.target.value))}
                          >
                            <option value="evm">EVM</option>
                            <option value="bitcoin">Bitcoin</option>
                          </select>
                        </label>
                        <label>
                          Amount USD
                          <input type="number" min="0" step="0.01" value={checkoutDraft.amountUsd} onChange={(event) => setCheckoutField('amountUsd', event.target.value)} placeholder="49.00" />
                        </label>
                        <label>
                          Success URL
                          <input value={checkoutDraft.successUrl} onChange={(event) => setCheckoutField('successUrl', event.target.value)} placeholder="https://merchant.app/success" />
                        </label>
                      </div>
                      <div className="field-grid">
                        <label>
                          Cancel URL
                          <input value={checkoutDraft.cancelUrl} onChange={(event) => setCheckoutField('cancelUrl', event.target.value)} placeholder="https://merchant.app/cancel" />
                        </label>
                      </div>
                      <div className="field-stack">
                        <div>
                          <div className="eyebrow">Networks for this checkout</div>
                          <div className="checkbox-grid">
                            {Object.entries(appConfig.chains || {})
                              .filter(([chain]) => chainRail(chain) === checkoutDraft.paymentRail)
                              .map(([chain, chainConfig]: [string, any]) => (
                                <label className="checkbox-pill" key={chain}>
                                  <input
                                    checked={checkoutDraft.enabledChains.includes(chain)}
                                    type="checkbox"
                                    onChange={(event) => setCheckoutField(
                                      'enabledChains',
                                      toggleStringValue(checkoutDraft.enabledChains, chain, event.target.checked)
                                    )}
                                  />
                                  <span>{chainConfig.name}</span>
                                </label>
                              ))}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Accepted assets for this checkout</div>
                          <div className="checkbox-grid">
                            {Object.keys(appConfig.assets || {})
                              .filter((asset) => assetRail(asset) === checkoutDraft.paymentRail)
                              .map((asset) => (
                                <label className="checkbox-pill" key={asset}>
                                  <input
                                    checked={checkoutDraft.acceptedAssets.includes(asset)}
                                    type="checkbox"
                                    onChange={(event) => setCheckoutField(
                                      'acceptedAssets',
                                      toggleStringValue(checkoutDraft.acceptedAssets, asset, event.target.checked)
                                    )}
                                  />
                                  <span>{asset}</span>
                                </label>
                              ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>

                  <div className="row">
                    <button className="primary-button" type="submit">Create checkout</button>
                    <button className="secondary-button" type="button" onClick={() => void handleCreateCheckout(true)}>Resolve via webhook</button>
                  </div>
                  <div className="muted">
                    {createdCheckout ? (
                      <div className="dashboard-inline-result">
                        <span className="badge ok">{createdCheckout.resolved ? 'Resolved via webhook' : 'Checkout created'}</span>
                        <a href={createdCheckout.checkoutUrl} rel="noreferrer" target="_blank">{createdCheckout.checkoutUrl}</a>
                        <span className="muted">
                          {createdCheckout.checkout.title || createdCheckout.checkout.orderId} · {railLabel(createdCheckout.checkout.paymentRail)} · {formatUsd(createdCheckout.checkout.amountUsd)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </fieldset>
              </form>
            </section>

            <section className="card dashboard-panel" hidden={activeSection !== 'payments'}>
              <div className="panel-header panel-header-inline">
                <div className="stack-sm">
                  <span className="eyebrow">Payments</span>
                  <h2>User payments</h2>
                  <p className="muted">Track submitted and confirmed payments, then export the ledger when finance needs it.</p>
                </div>
                <button className="secondary-button" type="button" onClick={handleExportPayments}>Export CSV</button>
              </div>
              <div className="payments-toolbar">
                <label className="payments-toolbar-search">
                  Search
                  <input value={paymentFilter.search} onChange={(event) => setPaymentFilter((current) => ({ ...current, search: event.target.value }))} placeholder="Order, title, wallet, or tx hash" />
                </label>
                <label>
                  Status
                  <select value={paymentFilter.status} onChange={(event) => setPaymentFilter((current) => ({ ...current, status: event.target.value }))}>
                    <option value="all">All statuses</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label>
                  Method
                  <select value={paymentFilter.method} onChange={(event) => setPaymentFilter((current) => ({ ...current, method: event.target.value }))}>
                    <option value="all">All methods</option>
                    <option value="onchain">Wallet</option>
                    <option value="manual">Manual pay</option>
                  </select>
                </label>
                <label>
                  Period
                  <select value={paymentFilter.range} onChange={(event) => setPaymentFilter((current) => ({ ...current, range: event.target.value }))}>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                    <option value="all">All time</option>
                  </select>
                </label>
                <div className="payments-toolbar-meta muted">
                  {filteredPayments.length} of {payments.length} payments · {formatUsd(filteredVolume)} confirmed volume in view
                </div>
              </div>
              <div className="list-stack muted">
                {filteredPayments.length ? filteredPayments.map((payment: any) => {
                  const checkout = payment.checkout || {};
                  const txUrl = explorerTx(payment.chain, payment.txHash);
                  const txLabel = payment.txHash ? `${payment.txHash.slice(0, 10)}...` : 'manual';
                  return (
                    <div className="payment-row" key={payment.id}>
                      <div className="payment-cell payment-primary">
                        <strong>{checkout.title || checkout.orderId || payment.checkoutId}</strong>
                        <span className="muted">{checkout.orderId || payment.checkoutId}</span>
                        <span className="muted">{payment.walletAddress || 'Wallet not captured'}</span>
                      </div>
                      <div className="payment-cell">
                        <span className="payment-cell-label">Amount</span>
                        <strong>{formatUsd(checkout.amountUsd || 0)}</strong>
                      </div>
                      <div className="payment-cell">
                        <span className="payment-cell-label">Route</span>
                        <strong>{(payment.asset || '').toUpperCase()} {payment.chain ? `· ${chainLabel(appConfig, payment.chain)}` : ''}</strong>
                        <span className="muted">{payment.method === 'manual' ? 'Manual pay' : 'Wallet pay'}</span>
                      </div>
                      <div className="payment-cell">
                        <span className="payment-cell-label">Status</span>
                        <span className={`badge ${paymentTone(payment.status)}`}>{payment.status}</span>
                      </div>
                      <div className="payment-cell payment-cell-end">
                        <span className="payment-cell-label">{formatDate(payment.createdAt)}</span>
                        {txUrl ? <a href={txUrl} rel="noreferrer" target="_blank">{txLabel}</a> : <span className="muted">{txLabel}</span>}
                      </div>
                    </div>
                  );
                }) : 'No payments match the current filters.'}
              </div>
            </section>

            <section className="dashboard-panel dashboard-activity-panel" hidden={activeSection !== 'activity'}>
              <div className="activity-grid">
                <article className="card">
                  <div className="panel-header">
                    <span className="eyebrow">Recent checkouts</span>
                    <h2>Session activity</h2>
                  </div>
                  <div className="list-stack muted">
                    {(dashboardData?.checkouts || []).length ? (dashboardData.checkouts || []).map((checkout: any) => (
                      <div className="checkout-list-item" key={checkout.id}>
                        <div className="checkout-list-meta">
                          <strong>{checkout.title || checkout.orderId}</strong>
                          <span className="muted">{formatUsd(checkout.amountUsd)} · {(checkout.acceptedAssets || [checkout.asset]).join(' · ')}</span>
                        </div>
                        <div className="checkout-list-meta" style={{ textAlign: 'right' }}>
                          <span className={`badge ${checkout.status === 'paid' ? 'ok' : 'warn'}`}>{checkout.status}</span>
                          <a href={`/checkout/${checkout.id}`} rel="noreferrer" target="_blank">Open checkout</a>
                        </div>
                      </div>
                    )) : 'No checkouts yet.'}
                  </div>
                </article>

                <div className="field-stack">
                  <article className="card">
                    <div className="panel-header">
                      <span className="eyebrow">Events</span>
                      <h2>Payment events</h2>
                    </div>
                    <div className="list-stack muted">
                      {(dashboardData?.events || []).length ? dashboardData.events.map((event: any) => (
                        <div className="event-item" key={event.id}>
                          <div className="event-meta">
                            <strong>{event.type}</strong>
                            <span className="muted">{event.data?.title || event.data?.orderId || event.checkoutId}</span>
                          </div>
                          <span className="muted">{formatDate(event.createdAt)}</span>
                        </div>
                      )) : 'No events yet.'}
                    </div>
                  </article>

                  <article className="card">
                    <div className="panel-header">
                      <span className="eyebrow">Webhook deliveries</span>
                      <h2>Outbound logs</h2>
                    </div>
                    <div className="list-stack muted">
                      {(dashboardData?.webhookDeliveries || []).length ? dashboardData.webhookDeliveries.map((delivery: any) => (
                        <div className="delivery-item" key={delivery.id}>
                          <div className="event-meta">
                            <strong>{delivery.status}</strong>
                            <span className="muted">{delivery.endpoint}</span>
                          </div>
                          <span className="muted">{delivery.responseCode || 'n/a'}</span>
                        </div>
                      )) : 'No deliveries yet.'}
                    </div>
                  </article>
                </div>
              </div>
            </section>
          </div>
        </section>
          </>
        )}
      </main>
    </>
  );
}

function isDashboardSection(value: string): value is DashboardSection {
  return [...setupItems.map(([key]) => key), ...runItems.map(([key]) => key)].includes(value as DashboardSection);
}
