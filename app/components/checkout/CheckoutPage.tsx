import { useEffect, useEffectEvent, useMemo, useState } from 'react'

import { fetchJson, jsonRequest } from '../../lib/browser/api'
import {
  activeQuotes,
  balanceForQuote,
  chainHex,
  chainLabel,
  checkoutTemplate,
  defaultMerchantLogo,
  dueAmountClassName,
  explorerTx,
  formatCountdown,
  formatUsdAmount,
  isQuotePayable,
  manualPaymentAvailable,
  merchantDisplayName,
  merchantHeroParts,
  paymentWindowExpired,
  paymentWindowRemainingMs,
  pendingOnchainPayment,
  quoteKey,
  refreshNeeded,
  routeScore,
  safeLogoSrc,
} from './checkout.shared'

type CheckoutPageProps = {
  checkoutId: string
  initialData: any
  templateParam?: string
}

export function CheckoutPage({
  checkoutId,
  initialData,
  templateParam = '',
}: CheckoutPageProps) {
  const [viewState, setViewState] = useState<any>({
    ...initialData,
    balances: {},
    manualDetails: null,
  })
  const [walletSession, setWalletSession] = useState<any>(null)
  const [manualPanelOpen, setManualPanelOpen] = useState(false)
  const [manualSelectedRouteKey, setManualSelectedRouteKey] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [manualAddressCopied, setManualAddressCopied] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [logoSrc, setLogoSrc] = useState(
    safeLogoSrc(initialData?.checkout?.merchantLogoUrl),
  )

  const checkout = viewState?.checkout
  const quotes = viewState?.quotes || []
  const payments = viewState?.payments || []
  const config = viewState?.config || {}
  const paymentRail =
    checkout?.paymentRail === 'bitcoin'
      ? 'bitcoin'
      : quotes.some((quote: any) => quote.chain !== 'bitcoin')
        ? 'evm'
        : 'bitcoin'
  const pendingPayment = pendingOnchainPayment(payments)
  const expired = paymentWindowExpired({ checkout, quotes, payments }, now)
  const remainingMs = paymentWindowRemainingMs(quotes, now)
  const manualRoutes =
    viewState?.manualDetails?.routes || checkout?.manualPayment?.routes || []
  const selectedManualRoute =
    manualRoutes.find((route: any) => route.key === manualSelectedRouteKey) ||
    manualRoutes.find(
      (route: any) => route.key === viewState?.manualDetails?.preferredRouteKey,
    ) ||
    manualRoutes[0] ||
    null

  useEffect(() => {
    setViewState({
      ...initialData,
      balances: {},
      manualDetails: null,
    })
    setWalletSession(null)
    setManualPanelOpen(false)
    setManualSelectedRouteKey('')
    setIsBusy(false)
    setStatusMessage('')
    setManualAddressCopied(false)
    setNow(Date.now())
    setLogoSrc(safeLogoSrc(initialData?.checkout?.merchantLogoUrl))
  }, [checkoutId, initialData])

  useEffect(() => {
    document.body.classList.add('checkout-page')
    return () => {
      document.body.classList.remove('checkout-page')
      document.body.classList.remove('checkout-template-oasis')
      document.body.classList.remove('checkout-template-neutral')
    }
  }, [])

  useEffect(() => {
    setLogoSrc(safeLogoSrc(checkout?.merchantLogoUrl))
    const template = checkoutTemplate(checkout, templateParam)
    document.body.classList.toggle('checkout-template-oasis', template === 'oasis')
    document.body.classList.toggle(
      'checkout-template-neutral',
      template === 'neutral',
    )
    if (checkout) {
      document.title = `${merchantDisplayName(checkout)} Checkout`
    }
  }, [checkout, templateParam])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    setManualAddressCopied(false)
  }, [selectedManualRoute?.address, checkoutId])

  const walletCompatibleQuotes = useMemo(() => {
    if (!walletSession) return []
    return activeQuotes(quotes, now).filter((quote) =>
      walletSession.rail === 'bitcoin'
        ? quote.chain === 'bitcoin'
        : quote.chain !== 'bitcoin',
    )
  }, [walletSession, quotes, now])

  const recommendedQuote = useMemo(() => {
    if (!walletSession) return null
    const payable = walletCompatibleQuotes.filter((quote) =>
      isQuotePayable(viewState?.balances, quote),
    )
    const ranked = (payable.length ? payable : walletCompatibleQuotes)
      .slice()
      .sort((a, b) => routeScore(a) - routeScore(b))
    return ranked[0] || null
  }, [walletSession, walletCompatibleQuotes, viewState?.balances])

  const availableWalletProviders = useMemo(() => {
    const next = []
    const liveQuotes = activeQuotes(quotes, now)
    const hasBitcoin = liveQuotes.some(
      (quote: any) => quote.chain === 'bitcoin' && quote.asset === 'BTC',
    )
    const hasEvm = liveQuotes.some((quote: any) => quote.chain !== 'bitcoin')
    if (paymentRail === 'evm' && hasEvm)
      next.push({ id: 'injected-evm', label: 'Injected EVM', rail: 'evm' })
    if (paymentRail === 'bitcoin' && hasBitcoin)
      next.push({ id: 'xverse', label: 'Xverse BTC', rail: 'bitcoin' })
    return next
  }, [paymentRail, quotes, now])

  const refreshStatus = useEffectEvent(async () => {
    const next = await fetchJson<any>(`/api/checkouts/${checkoutId}/status`)
    setViewState((current: any) => ({
      ...current,
      ...next,
      config: current?.config,
      balances: current?.balances || {},
      manualDetails: current?.manualDetails || null,
    }))
    if (next?.checkout?.status === 'paid') {
      setManualPanelOpen(false)
      setIsBusy(false)
    }
  })

  useEffect(() => {
    void refreshStatus().catch(() => {})
  }, [checkoutId, refreshStatus])

  useEffect(() => {
    if (checkout?.status === 'paid') return
    const watchManual = manualPanelOpen && manualPaymentAvailable(checkout)
    const watchPending = Boolean(pendingPayment)
    if (!watchManual && !watchPending) return
    const timer = window.setInterval(() => {
      void refreshStatus().catch(() => {})
    }, 3000)
    return () => window.clearInterval(timer)
  }, [checkout?.status, manualPanelOpen, pendingPayment, checkoutId, refreshStatus])

  async function loadManualDetails() {
    if (!manualPaymentAvailable(checkout)) return null
    const details = await fetchJson<any>(
      `/api/checkouts/${checkoutId}/manual-payment`,
    )
    setViewState((current: any) => ({
      ...current,
      manualDetails: details,
    }))
    setManualSelectedRouteKey(
      (current) => current || details.preferredRouteKey || '',
    )
    return details
  }

  async function openManualPanel() {
    setStatusMessage('')
    if (!manualPaymentAvailable(checkout)) return
    setManualPanelOpen(true)
    if (!viewState?.manualDetails) {
      void loadManualDetails().catch((error: any) => {
        setStatusMessage(
          error?.message || 'Could not load manual payment details.',
        )
      })
    }
  }

  async function copyManualAddress() {
    const address =
      selectedManualRoute?.address ||
      viewState?.manualDetails?.address ||
      checkout?.manualPayment?.address
    if (!address) {
      setStatusMessage('Manual address unavailable.')
      return
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(address)
      setManualAddressCopied(true)
      setStatusMessage('Manual address copied.')
      window.setTimeout(() => setStatusMessage(''), 1200)
      window.setTimeout(() => setManualAddressCopied(false), 1600)
    }
  }

  async function connectWallet(providerId = availableWalletProviders[0]?.id || '') {
    if (!providerId) {
      setStatusMessage('No wallet provider is available for this checkout.')
      return
    }
    setIsBusy(true)
    setStatusMessage('')
    try {
      let session
      if (providerId === 'xverse') {
        const xverse = window.ChargeWithCryptoVendors?.xverse
        if (!xverse?.request || !xverse?.setDefaultProvider) {
          throw new Error('xverse wallet adapter unavailable')
        }
        const provider = xverse.DefaultAdaptersInfo?.xverse?.id
        if (provider) xverse.setDefaultProvider(provider)
        let response = await xverse.request('wallet_connect', {
          addresses: ['payment'],
          network: 'Mainnet',
          message:
            'Charge With Crypto wants to connect your Bitcoin payment address.',
        })
        let accounts = Array.isArray(response?.result?.addresses)
          ? response.result.addresses
          : Array.isArray(response?.result)
            ? response.result
            : []
        if (!accounts.length && xverse.AddressPurpose) {
          response = await xverse.request('getAccounts', {
            purposes: [xverse.AddressPurpose.Payment],
            message:
              'Charge With Crypto wants to connect your Bitcoin payment address.',
          })
          accounts = Array.isArray(response?.result?.addresses)
            ? response.result.addresses
            : Array.isArray(response?.result)
              ? response.result
              : []
        }
        if (response?.status === 'error') {
          throw new Error(response?.error?.message || 'xverse address request failed')
        }
        const paymentAccount =
          accounts.find(
            (account: any) =>
              String(account.purpose).toLowerCase() === 'payment',
          ) || accounts[0]
        if (!paymentAccount?.address)
          throw new Error('xverse did not return a payment address')
        session = {
          rail: 'bitcoin',
          provider: 'xverse',
          address: paymentAccount.address,
        }
      } else {
        if (!window.ethereum?.request) throw new Error('no injected wallet found')
        const accounts = (await window.ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[]
        const address = accounts?.[0]
        if (!address) throw new Error('wallet did not return an address')
        session = { rail: 'evm', provider: 'injected-evm', address }
      }

      setWalletSession(session)
      setManualPanelOpen(false)
      setStatusMessage('Wallet connected. Scanning balances...')

      const scan = await fetchJson<any>(
        `/api/checkouts/${checkoutId}/balance-scan`,
        jsonRequest(
          { walletAddress: session.address, walletRail: session.rail },
          { method: 'POST' },
        ),
      )
      const scannedBalances = Object.values(scan.balances || {})
      const hasDetectedBalance = scannedBalances.some((entry: any) => {
        const raw = entry?.raw
        if (raw == null) return false
        try {
          return BigInt(raw) > 0n
        } catch {
          return false
        }
      })
      setViewState((current: any) => ({
        ...current,
        balances: { ...(current?.balances || {}), ...(scan.balances || {}) },
      }))
      setStatusMessage(
        hasDetectedBalance
          ? 'Wallet connected. Route scan updated.'
          : 'Wallet connected. No supported balance was detected on this checkout yet.',
      )
    } catch (error: any) {
      setStatusMessage(error.message || 'Wallet connection failed.')
    } finally {
      setIsBusy(false)
    }
  }

  async function refreshQuote() {
    setIsBusy(true)
    setStatusMessage('')
    try {
      const quote = recommendedQuote
      const refreshed = await fetchJson<any>(
        `/api/checkouts/${checkoutId}/quote`,
        jsonRequest(
          quote ? { chain: quote.chain, asset: quote.asset } : {},
          { method: 'POST' },
        ),
      )
      setViewState((current: any) => {
        const byRoute = new Map(
          (current?.quotes || []).map((entry: any) => [quoteKey(entry), entry]),
        )
        for (const entry of refreshed.quotes || []) {
          byRoute.set(quoteKey(entry), entry)
        }
        return {
          ...current,
          quote: refreshed.quote,
          quotes: [...byRoute.values()],
        }
      })
      if (manualPanelOpen) await loadManualDetails()
    } catch (error: any) {
      setStatusMessage(error.message || 'Could not refresh prices.')
    } finally {
      setIsBusy(false)
    }
  }

  async function submitTx(txHash: string, walletAddress: string, quote: any) {
    await fetchJson(
      `/api/checkouts/${checkoutId}/submit-tx`,
      jsonRequest(
        {
          txHash,
          walletAddress,
          chain: quote.chain,
          asset: quote.asset,
          quoteId: quote.id,
        },
        { method: 'POST' },
      ),
    )
    await refreshStatus()
  }

  async function payWithWallet() {
    if (!recommendedQuote) {
      setStatusMessage('No compatible quote is available.')
      return
    }
    if (!isQuotePayable(viewState?.balances, recommendedQuote)) {
      setStatusMessage('Not enough balance on the recommended route.')
      return
    }

    setIsBusy(true)
    setStatusMessage('')

    try {
      if (walletSession?.provider === 'xverse') {
        const xverse = window.ChargeWithCryptoVendors?.xverse
        if (!xverse?.request || !xverse?.setDefaultProvider) {
          throw new Error('xverse wallet adapter unavailable')
        }
        const provider = xverse.DefaultAdaptersInfo?.xverse?.id
        if (provider) xverse.setDefaultProvider(provider)
        const amount = Number(recommendedQuote.cryptoAmountBaseUnits)
        if (!Number.isSafeInteger(amount)) {
          throw new Error('bitcoin amount exceeds safe integer range')
        }
        const response = await xverse.request('sendTransfer', {
          recipients: [
            {
              address:
                checkout?.recipientByChain?.bitcoin || checkout?.recipientAddress,
              amount,
            },
          ],
        })
        if (response?.status === 'error') {
          throw new Error(response?.error?.message || 'xverse transfer failed')
        }
        const txid = response?.result?.txid || response?.txid
        if (!txid) throw new Error('xverse transfer did not return a txid')
        await submitTx(txid, walletSession.address, recommendedQuote)
      } else {
        if (!window.ethereum?.request) throw new Error('no injected wallet found')
        const accounts = (await window.ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[]
        const walletAddress = accounts?.[0]
        if (!walletAddress) throw new Error('wallet did not return an address')

        const chainConfig = config.chains?.[recommendedQuote.chain]
        const recipientAddress =
          checkout?.recipientByChain?.[recommendedQuote.chain] ||
          checkout?.recipientAddress
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainHex(chainConfig.chainId) }],
        })

        let txHash
        if (recommendedQuote.asset === 'ETH') {
          txHash = (await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [
              {
                from: walletAddress,
                to: recipientAddress,
                value: `0x${BigInt(recommendedQuote.cryptoAmountBaseUnits).toString(16)}`,
              },
            ],
          })) as string
        } else {
          const tokenAddress =
            config.assets?.[recommendedQuote.asset]?.addresses?.[
              recommendedQuote.chain
            ]
          const methodId = '0xa9059cbb'
          const toArg = recipientAddress
            .toLowerCase()
            .replace(/^0x/, '')
            .padStart(64, '0')
          const amountArg = BigInt(recommendedQuote.cryptoAmountBaseUnits)
            .toString(16)
            .padStart(64, '0')
          txHash = (await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [
              {
                from: walletAddress,
                to: tokenAddress,
                data: `${methodId}${toArg}${amountArg}`,
              },
            ],
          })) as string
        }

        await submitTx(txHash, walletAddress, recommendedQuote)
      }
    } catch (error: any) {
      setStatusMessage(error.message || 'Payment submission failed.')
    } finally {
      setIsBusy(false)
    }
  }

  function disconnectWallet() {
    setWalletSession(null)
    setViewState((current: any) => ({
      ...current,
      balances: {},
    }))
    setStatusMessage('Wallet disconnected.')
  }

  const merchantName = merchantDisplayName(checkout)
  const heroParts = merchantHeroParts(checkout)
  const amountText = formatUsdAmount(checkout?.amountUsd)
  const walletConnected = Boolean(walletSession?.address)
  const walletMetaCopy = walletConnected
    ? 'Connected wallet'
    : expired
      ? 'Payment window expired. Refresh prices to continue.'
      : remainingMs != null
        ? `${paymentRail === 'bitcoin' ? 'Connect Xverse or pay manually to send BTC.' : 'Connect a wallet to review the best route for this payment.'} Payment window ${formatCountdown(remainingMs)}.`
        : paymentRail === 'bitcoin'
          ? 'Connect Xverse or pay manually to send BTC.'
          : 'Connect a wallet to review the best route for this payment.'

  const routeBalance = recommendedQuote
    ? balanceForQuote(viewState?.balances, recommendedQuote)
    : null
  const routePayable = recommendedQuote
    ? isQuotePayable(viewState?.balances, recommendedQuote)
    : false

  return (
    <>
      <script src="/vendor/xverse-wallet.js"></script>
      <div className="atmosphere atmosphere-a"></div>
      <div className="atmosphere atmosphere-b"></div>
      <div className="atmosphere atmosphere-c"></div>

      <main className="checkout-shell">
        <section className="checkout-brand-stage">
          <div className="brand-copy">
            <h1 className="brand-title">
              <span className="brand-line">CHECKOUT</span>
              <span className="brand-line brand-line-accent">
                <img
                  alt=""
                  className="brand-isotype"
                  src="/oasisvault-isotype-green.png"
                />
                <span>{heroParts.lead}</span>
              </span>
              <span className="brand-line" hidden={!heroParts.trail}>
                {heroParts.trail}
              </span>
            </h1>
            <p className="brand-description">
              {checkout?.description ||
                'Connect a wallet and Charge With Crypto will recommend the cleanest way to pay.'}
            </p>
          </div>
        </section>

        <section className="checkout-payment-stage">
          <section className="payment-card">
            <header className="payment-card-header">
              <div className="payment-heading">
                <div className="eyebrow">Review and pay</div>
                <h2>{checkout?.title || 'Review and pay'}</h2>
              </div>

              <div className="hero-total">
                <span className="eyebrow">Amount due</span>
                <div className={dueAmountClassName(amountText)} title={amountText}>
                  {amountText}
                </div>
                <div className="pill-row">
                  {(checkout?.acceptedAssets || [checkout?.asset]).map(
                    (asset: string) => (
                      <span className="asset-pill" key={asset}>
                        {asset}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </header>

            {checkout?.status === 'paid' ? (
              <section className="success-card">
                <div className="success-mark">Paid</div>
                <div className="success-head">
                  <h2>Payment confirmed</h2>
                  <p className="muted">{`${checkout.title || 'Payment'} was confirmed on ${chainLabel(config, payments.find((payment: any) => payment.status === 'confirmed')?.chain || checkout?.paidChain || checkout?.defaultChain)}.`}</p>
                </div>
                <div className="success-meta">
                  <div className="success-meta-row">
                    <span>Amount</span>
                    <strong>{formatUsdAmount(checkout.amountUsd)}</strong>
                  </div>
                  <div className="success-meta-row">
                    <span>Asset</span>
                    <strong>
                      {payments.find((payment: any) => payment.status === 'confirmed')
                        ?.asset ||
                        checkout?.paidAsset ||
                        checkout?.defaultAsset ||
                        checkout?.asset}
                    </strong>
                  </div>
                  <div className="success-meta-row">
                    <span>Network</span>
                    <strong>
                      {chainLabel(
                        config,
                        payments.find((payment: any) => payment.status === 'confirmed')
                          ?.chain ||
                          checkout?.paidChain ||
                          checkout?.defaultChain,
                      )}
                    </strong>
                  </div>
                  {payments.find((payment: any) => payment.status === 'confirmed')
                    ?.txHash ? (
                    <div className="success-meta-row">
                      <span>Transaction</span>
                      <strong>
                        <a
                          href={explorerTx(
                            payments.find((payment: any) => payment.status === 'confirmed')
                              ?.chain ||
                              checkout?.paidChain ||
                              checkout?.defaultChain,
                            payments.find((payment: any) => payment.status === 'confirmed')
                              ?.txHash,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {payments
                            .find((payment: any) => payment.status === 'confirmed')
                            ?.txHash.slice(0, 10)}
                          ...
                        </a>
                      </strong>
                    </div>
                  ) : null}
                </div>
                <div className="row">
                  {checkout?.successUrl ? (
                    <a className="link-button" href={checkout.successUrl}>
                      Return to merchant
                    </a>
                  ) : null}
                </div>
              </section>
            ) : (
              <div className="payment-flow">
                {walletConnected ? (
                  <div className="wallet-connected-inline" hidden={manualPanelOpen}>
                    <span className="wallet-connected-address">
                      {walletSession.address}
                    </span>
                    <button
                      className="tiny-link wallet-disconnect"
                      type="button"
                      onClick={disconnectWallet}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="card wallet-stage" hidden={manualPanelOpen}>
                    <div className="stack-sm">
                      <span className="eyebrow">Step 1</span>
                      <h2>Connect a wallet</h2>
                      <p className="muted">{walletMetaCopy}</p>
                    </div>
                    <div className="wallet-actions-stack">
                      {paymentRail !== 'bitcoin' ? (
                        <button
                          className="primary-button"
                          disabled={isBusy || expired}
                          type="button"
                          onClick={() => void connectWallet()}
                        >
                          {isBusy ? 'Connecting…' : 'Connect wallet'}
                        </button>
                      ) : null}
                      {paymentRail === 'bitcoin' ||
                      availableWalletProviders.length > 1 ? (
                        <div className="wallet-provider-buttons">
                          {availableWalletProviders.map((provider) => (
                            <button
                              className="secondary-button wallet-provider-button"
                              disabled={isBusy || expired}
                              key={provider.id}
                              type="button"
                              onClick={() => void connectWallet(provider.id)}
                            >
                              {provider.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {manualPaymentAvailable(checkout) ? (
                        <button
                          className="tiny-link"
                          hidden={manualPanelOpen}
                          type="button"
                          onClick={() => void openManualPanel()}
                        >
                          Don&apos;t have a wallet? Pay manually
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}

                <section
                  className="card manual-panel"
                  hidden={
                    !manualPanelOpen || !manualPaymentAvailable(checkout) || expired
                  }
                >
                  <div className="manual-panel-head">
                    <div className="stack-sm">
                      <span className="eyebrow">Manual pay</span>
                      <h2>Send crypto manually</h2>
                      <p className="muted">
                        {selectedManualRoute?.chain === 'bitcoin'
                          ? `Send exactly ${selectedManualRoute?.preferredQuote?.cryptoAmount || checkout?.amountUsd} BTC to this unique Bitcoin address. We watch the address automatically and confirm after the required block depth.`
                          : (selectedManualRoute?.acceptedAssets || []).length
                            ? `Send exactly ${selectedManualRoute?.preferredQuote?.cryptoAmount || checkout?.amountUsd} in ${(selectedManualRoute?.acceptedAssets || []).join(' or ')} to this unique deposit address. We confirm supported transfers automatically.`
                            : 'Send the exact amount to this unique deposit address. We confirm supported transfers automatically.'}
                      </p>
                      <button
                        className="tiny-link manual-switch-link"
                        type="button"
                        onClick={() => setManualPanelOpen(false)}
                      >
                        Have a hot wallet? Connect it instead
                      </button>
                    </div>
                    <span
                      className={`badge ${checkout?.status === 'paid' ? 'ok' : 'warn'}`}
                    >
                      {checkout?.status === 'paid'
                        ? 'Payment found'
                        : selectedManualRoute?.chain === 'bitcoin'
                          ? 'Watching Bitcoin'
                          : 'Watching chains'}
                    </span>
                  </div>
                  <div className="manual-grid">
                    <div
                      aria-hidden="true"
                      className="manual-qr-frame"
                      dangerouslySetInnerHTML={{
                        __html:
                          selectedManualRoute?.qrSvg ||
                          '<div class="muted">QR unavailable</div>',
                      }}
                    />
                    <div className="manual-copy">
                      <div className="manual-amount-block">
                        <span className="eyebrow">Amount</span>
                        <strong className="manual-amount">
                          {selectedManualRoute?.preferredQuote
                            ? `${selectedManualRoute.preferredQuote.cryptoAmount} ${selectedManualRoute.preferredQuote.asset}`
                            : amountText}
                        </strong>
                      </div>
                      <div className="manual-address-block">
                        <span className="eyebrow">Deposit address</span>
                        <div className="code manual-address">
                          {selectedManualRoute?.address || 'Address unavailable'}
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void copyManualAddress()}
                        >
                          {manualAddressCopied ? 'Copied ✓' : 'Copy address'}
                        </button>
                        <p className="manual-address-note muted">
                          Demo note: in production, set{' '}
                          <code>MANUAL_PAYMENT_XPUB</code> so each checkout gets a
                          unique deposit address automatically.
                        </p>
                      </div>
                      <div>
                        <span className="eyebrow">Accepted assets</span>
                        <div className="pill-row">
                          {(selectedManualRoute?.acceptedAssets || []).map(
                            (asset: string) => (
                              <span className="asset-pill" key={asset}>
                                {asset}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="eyebrow">Networks</span>
                        <div className="pill-row">
                          {(selectedManualRoute?.enabledChains || []).map(
                            (chain: string) => (
                              <span className="asset-pill" key={chain}>
                                {chainLabel(config, chain)}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="manual-status muted">
                    {checkout?.status === 'paid'
                      ? (() => {
                          const payment = payments.find(
                            (entry: any) => entry.status === 'confirmed',
                          )
                          return payment?.txHash ? (
                            <span>
                              Payment confirmed on {chainLabel(config, payment.chain)}
                              .{' '}
                              <a
                                href={explorerTx(payment.chain, payment.txHash)}
                                rel="noreferrer"
                                target="_blank"
                              >
                                View transaction
                              </a>
                            </span>
                          ) : (
                            'Payment confirmed onchain.'
                          )
                        })()
                      : selectedManualRoute?.chain === 'bitcoin'
                        ? 'We watch the checkout address automatically after you send BTC. No tx hash is required.'
                        : 'We monitor supported chains automatically after you send the funds. No tx hash or wallet connection is required.'}
                  </div>
                </section>

                <section
                  className="card route-stage"
                  hidden={!walletConnected || manualPanelOpen}
                >
                  <div className="recommendation">
                    {recommendedQuote ? (
                      <div className="route-heading">
                        <div>
                          <span className="eyebrow">Step 2</span>
                          <h2>Best payment route</h2>
                        </div>
                        <span className={`badge ${routePayable ? 'ok' : 'warn'}`}>
                          {routePayable ? 'Ready to pay' : 'Balance too low'}
                        </span>
                      </div>
                    ) : (
                      <span className="badge warn">Route unavailable</span>
                    )}
                    <p className="muted">
                      {recommendedQuote
                        ? 'Charge With Crypto scans the connected wallet and focuses the checkout on one route that matches the selected rail.'
                        : 'No compatible payable route was found for the connected wallet.'}
                    </p>
                  </div>

                  <div className="quote-grid">
                    {recommendedQuote ? (
                      <div className="route-card recommended-route-card">
                        <div className="route-card-main">
                          <div className="route-topline">
                            <strong>{chainLabel(config, recommendedQuote.chain)}</strong>
                            <span className="asset-tag">{recommendedQuote.asset}</span>
                          </div>
                          <div className="route-amount">
                            {recommendedQuote.cryptoAmount} {recommendedQuote.asset}
                          </div>
                          <p className="muted">
                            {routePayable
                              ? `Detected balance makes ${chainLabel(config, recommendedQuote.chain)} the cleanest route right now.`
                              : 'This is the cleanest route for the connected wallet, but the balance is still below the exact amount due.'}
                          </p>
                        </div>
                        <div className="route-side">
                          <span className="eyebrow">Wallet balance</span>
                          <strong className="balance-value">
                            {routeBalance?.display
                              ? `${routeBalance.display} ${recommendedQuote.asset}`
                              : routeBalance?.error || 'Unavailable'}
                          </strong>
                          <span className={`badge ${routePayable ? 'ok' : 'warn'}`}>
                            {routePayable ? 'Payable now' : 'Needs more balance'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="route-card">
                        <span className="badge warn">Route unavailable</span>
                        <span className="muted">
                          No compatible route was found for the connected wallet.
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                <div className="pay-actions" hidden={!walletConnected || manualPanelOpen}>
                  <button
                    className="primary-button"
                    disabled={
                      isBusy ||
                      !recommendedQuote ||
                      !routePayable ||
                      checkout?.status === 'paid'
                    }
                    type="button"
                    onClick={() => void payWithWallet()}
                  >
                    {recommendedQuote
                      ? `Pay ${recommendedQuote.cryptoAmount} ${recommendedQuote.asset}`
                      : 'Pay'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isBusy}
                    hidden={!refreshNeeded(config, checkout) && !expired}
                    type="button"
                    onClick={() => void refreshQuote()}
                  >
                    Refresh prices
                  </button>
                </div>

                <section className="card checkout-info-card">
                  <div className="summary-panel muted">
                    <div className="summary-brand">
                      <LogoImage
                        alt={`${merchantName} logo`}
                        className="summary-logo"
                        src={logoSrc}
                        setLogoSrc={setLogoSrc}
                      />
                      <div className="summary-brand-copy">
                        <div className="eyebrow">Merchant</div>
                        <div className="summary-brand-row">
                          <strong className="summary-brand-name">
                            {merchantName}
                          </strong>
                          <div className="muted small-copy summary-brand-description">
                            {checkout?.description || 'Wallet-first crypto checkout'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <div
                  className="status-inline muted"
                  hidden={!statusMessage && !pendingPayment && !expired}
                >
                  {checkout?.status === 'paid' ? null : pendingPayment ? (
                    <div className="status-card">
                      <span className="badge warn">Payment submitted</span>
                      <div className="status-copy">
                        Confirming on{' '}
                        {chainLabel(config, pendingPayment.chain || checkout?.defaultChain)}
                        .
                      </div>
                      {pendingPayment.txHash ? (
                        <a
                          href={explorerTx(
                            pendingPayment.chain || checkout?.defaultChain,
                            pendingPayment.txHash,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View transaction
                        </a>
                      ) : null}
                    </div>
                  ) : expired ? (
                    <div className="status-card">
                      <span className="badge warn">Payment window expired</span>
                      <div className="status-copy">
                        {paymentRail === 'bitcoin'
                          ? 'Broadcast the Bitcoin transaction within 2 minutes. Refresh prices to continue.'
                          : 'This payment window expired. Refresh prices to continue.'}
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void refreshQuote()}
                      >
                        Refresh prices
                      </button>
                    </div>
                  ) : statusMessage ? (
                    <div className="status-card">
                      <span className="badge warn">Action update</span>
                      <div className="status-copy">{statusMessage}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </section>
      </main>
    </>
  )
}

function LogoImage({
  alt,
  className,
  src,
  setLogoSrc,
}: {
  alt: string
  className: string
  src: string
  setLogoSrc: (value: string) => void
}) {
  return (
    <img
      alt={alt}
      className={className}
      src={src}
      onError={() => setLogoSrc(defaultMerchantLogo)}
    />
  )
}
