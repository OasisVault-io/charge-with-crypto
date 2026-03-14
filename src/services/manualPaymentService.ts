// @ts-nocheck
const { Contract, HDNodeWallet, JsonRpcProvider, Wallet } = require('ethers');
const QRCode = require('qrcode');
const { getActiveQuotesForCheckout } = require('./quoteService');
const { isFixedPegAsset } = require('./priceService');
const { recordManualDetectedPayment } = require('./paymentService');
const { nowIso } = require('../utils/time');
const { normalizeAddress } = require('../utils/validation');
const { requestJson } = require('./merchantWebhookService');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];
const DEFAULT_LOOKBACK_BLOCKS = 24;
const CHAIN_PREFERENCE = ['base', 'arbitrum', 'polygon', 'ethereum'];
const ASSET_PREFERENCE = ['USDC', 'USDT', 'ETH'];

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function topicAddress(topic) {
  return `0x${String(topic || '').slice(-40)}`.toLowerCase();
}

function topicForAddress(address) {
  return `0x${normalizeAddress(address).replace(/^0x/, '').padStart(64, '0')}`;
}

function routeScore(quote) {
  const assetIndex = ASSET_PREFERENCE.indexOf(quote.asset);
  const chainIndex = CHAIN_PREFERENCE.indexOf(quote.chain);
  return ((assetIndex === -1 ? 99 : assetIndex) * 10) + (chainIndex === -1 ? 99 : chainIndex);
}

function sortLogs(logs) {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber) - Number(b.blockNumber);
    return Number(a.index || a.logIndex || 0) - Number(b.index || b.logIndex || 0);
  });
}

class ManualPaymentService {
  constructor({ store, config }) {
    this.store = store;
    this.config = config;
    this.xpub = String(config.manualPaymentXpub || '').trim();
    this.mnemonic = String(config.manualPaymentMnemonic || '').trim();
    this.derivationPath = String(config.manualPaymentDerivationPath || "m/44'/60'/0'/0").trim();
    this.sweepSignerUrl = String(config.manualPaymentSweepSignerUrl || '').trim();
    this.sweepSignerSecret = String(config.manualPaymentSweepSignerSecret || '').trim();
    this.sponsorPrivateKey = String(config.manualPaymentSweepSponsorPrivateKey || '').trim();
    this.scanIntervalMs = Math.max(5000, Number(config.manualPaymentScanIntervalMs || 15000));
    this.scanBlockWindow = Math.max(20, Number(config.manualPaymentScanBlockWindow || 250));
    this.providers = new Map();
    this.timer = null;
    this.running = false;
    this.counterLock = Promise.resolve();
    this.rootXpub = this.xpub ? HDNodeWallet.fromExtendedKey(this.xpub) : null;
    this.derivationMode = this.rootXpub ? 'xpub' : (this.mnemonic ? 'mnemonic' : 'disabled');
    this.sweepMode = this.sweepSignerUrl
      ? 'external_signer'
      : (this.mnemonic && this.sponsorPrivateKey ? 'local' : 'manual');
    this.sponsorAddress = this.sweepMode === 'local' && this.sponsorPrivateKey ? new Wallet(this.sponsorPrivateKey).address : '';

    for (const [chain, chainConfig] of Object.entries(config.chains)) {
      const endpoint = process.env[chainConfig.rpcUrlEnv];
      if (!endpoint) continue;
      this.providers.set(chain, new JsonRpcProvider(endpoint));
    }
  }

  isConfigured() {
    return Boolean((this.rootXpub || this.mnemonic) && this.providers.size);
  }

  status() {
    return {
      configured: this.isConfigured(),
      derivationMode: this.derivationMode,
      sweepMode: this.sweepMode,
      sponsorAddress: this.sponsorAddress || '',
      derivationPath: this.derivationPath
    };
  }

  provider(chain) {
    const provider = this.providers.get(chain);
    if (!provider) throw new Error(`missing manual payment rpc for ${chain}`);
    return provider;
  }

  deriveWallet(index, chain) {
    const numericIndex = Number(index);
    if (this.rootXpub) {
      const wallet = this.rootXpub.deriveChild(numericIndex);
      return chain ? wallet.connect(this.provider(chain)) : wallet;
    }
    const path = `${this.derivationPath}/${numericIndex}`;
    const wallet = HDNodeWallet.fromPhrase(this.mnemonic, undefined, path);
    return chain ? wallet.connect(this.provider(chain)) : wallet;
  }

  canAutoSweep() {
    return this.sweepMode === 'local' || this.sweepMode === 'external_signer';
  }

  pendingSweepStatus() {
    return this.canAutoSweep() ? 'queued' : 'manual_required';
  }

  nextDerivationIndexFromCheckouts() {
    const indexes = this.store.find('checkouts', (checkout) => Number.isInteger(checkout?.manualPayment?.derivationIndex))
      .map((checkout) => Number(checkout.manualPayment.derivationIndex))
      .filter((value) => Number.isInteger(value) && value >= 0);
    return indexes.length ? Math.max(...indexes) + 1 : 0;
  }

  async reserveDerivationIndex() {
    const pending = this.counterLock;
    let release;
    this.counterLock = new Promise((resolve) => { release = resolve; });
    await pending;
    try {
      const existing = this.store.getById('counters', 'manual_payment_derivation_index');
      if (existing) {
        const index = Number(existing.value || 0);
        this.store.update('counters', existing.id, { value: index + 1 });
        return index;
      }
      const index = this.nextDerivationIndexFromCheckouts();
      this.store.insert('counters', { id: 'manual_payment_derivation_index', value: index + 1 });
      return index;
    } finally {
      release();
    }
  }

  merchantEnabledChains(merchant, checkout) {
    const merchantChains = uniq(merchant?.manualPaymentEnabledChains || merchant?.enabledChains || []);
    const checkoutChains = uniq(checkout?.enabledChains || []);
    return merchantChains.filter((chain) => checkoutChains.includes(chain) && this.config.chains[chain]);
  }

  manualQuotes(checkout, quotes) {
    const manualPayment = checkout?.manualPayment || {};
    const allowedChains = new Set(manualPayment.enabledChains || []);
    const allowedAssets = new Set(manualPayment.acceptedAssets || []);
    return (quotes || []).filter((quote) => allowedChains.has(quote.chain) && allowedAssets.has(quote.asset) && isFixedPegAsset(quote.asset));
  }

  preferredQuote(checkout, quotes) {
    const candidates = this.manualQuotes(checkout, quotes);
    return candidates.sort((a, b) => routeScore(a) - routeScore(b))[0] || null;
  }

  async createCheckoutManualPayment({ merchant, checkout, quotes }) {
    const enabledChains = this.merchantEnabledChains(merchant, checkout).filter((chain) => this.providers.has(chain));
    const acceptedAssets = uniq((quotes || []).filter((quote) => enabledChains.includes(quote.chain) && isFixedPegAsset(quote.asset)).map((quote) => quote.asset));
    const supportedChains = uniq((quotes || []).filter((quote) => enabledChains.includes(quote.chain) && acceptedAssets.includes(quote.asset)).map((quote) => quote.chain));

    if (!supportedChains.length || !acceptedAssets.length) {
      return {
        available: false,
        status: 'disabled',
        reason: 'Manual pay is only available for fixed stablecoin routes enabled by the merchant.',
        enabledChains: [],
        acceptedAssets: []
      };
    }

    if (!this.isConfigured()) {
      return {
        available: false,
        status: 'disabled',
        reason: 'Manual pay engine is not configured on the server.',
        enabledChains: supportedChains,
        acceptedAssets
      };
    }

    const derivationIndex = await this.reserveDerivationIndex();
    const wallet = this.deriveWallet(derivationIndex);
    const initializedAt = nowIso();
    const scanState = Object.fromEntries(supportedChains.map((chain) => [chain, {
      nextBlock: null,
      lastScannedBlock: null,
      initializedAt
    }]));

    return {
      available: true,
      status: 'awaiting_payment',
      derivationIndex,
      address: wallet.address,
      enabledChains: supportedChains,
      acceptedAssets,
      scanState,
      sweepStatus: 'idle',
      sponsorAddress: this.sponsorAddress || ''
    };
  }

  async getCheckoutDetails(checkout) {
    const manualPayment = checkout?.manualPayment;
    if (!manualPayment?.available || !manualPayment.address) return { available: false };
    const quotes = getActiveQuotesForCheckout(this.store, checkout.id);
    const preferredQuote = this.preferredQuote(checkout, quotes);
    const qrSvg = await QRCode.toString(manualPayment.address, {
      type: 'svg',
      margin: 0,
      color: { dark: '#27fa7b', light: '#0000' }
    });

    return {
      available: true,
      address: manualPayment.address,
      enabledChains: manualPayment.enabledChains || [],
      acceptedAssets: manualPayment.acceptedAssets || [],
      status: manualPayment.status || 'awaiting_payment',
      detectedChain: manualPayment.detectedChain || '',
      detectedAsset: manualPayment.detectedAsset || '',
      detectedTxHash: manualPayment.detectedTxHash || '',
      qrSvg,
      preferredQuote: preferredQuote
        ? {
            id: preferredQuote.id,
            chain: preferredQuote.chain,
            asset: preferredQuote.asset,
            cryptoAmount: preferredQuote.cryptoAmount,
            cryptoAmountBaseUnits: preferredQuote.cryptoAmountBaseUnits
          }
        : null
    };
  }

  async reconcileCheckout(checkout) {
    if (!checkout?.manualPayment?.available || checkout.status === 'paid') return checkout;
    const quotes = getActiveQuotesForCheckout(this.store, checkout.id);
    const candidateQuotes = this.manualQuotes(checkout, quotes);
    if (!candidateQuotes.length) return checkout;

    const quotesByChain = new Map();
    for (const quote of candidateQuotes) {
      if (!quotesByChain.has(quote.chain)) quotesByChain.set(quote.chain, []);
      quotesByChain.get(quote.chain).push(quote);
    }

    let latestCheckout = checkout;
    for (const [chain, chainQuotes] of quotesByChain.entries()) {
      latestCheckout = await this.scanChainForCheckout(latestCheckout, chain, chainQuotes);
      if (latestCheckout.status === 'paid') break;
    }

    return this.store.getById('checkouts', checkout.id) || latestCheckout;
  }

  async scanChainForCheckout(checkout, chain, quotes) {
    const manualPayment = checkout.manualPayment || {};
    const scanState = { ...(manualPayment.scanState || {}) };
    const chainState = { ...(scanState[chain] || {}) };
    const provider = this.provider(chain);
    let latestBlock = await provider.getBlockNumber();
    let confirmedToBlock = Math.max(0, latestBlock - Math.max(0, this.config.minConfirmations - 1));

    let fromBlock = Number.isInteger(chainState.nextBlock) ? chainState.nextBlock : null;
    if (fromBlock == null) fromBlock = Math.max(0, confirmedToBlock - DEFAULT_LOOKBACK_BLOCKS);
    if (fromBlock > confirmedToBlock) {
      scanState[chain] = { ...chainState, latestBlock, nextBlock: fromBlock };
      this.store.update('checkouts', checkout.id, {
        manualPayment: { ...manualPayment, scanState }
      });
      return this.store.getById('checkouts', checkout.id) || checkout;
    }

    let scanToBlock = Math.min(confirmedToBlock, fromBlock + this.scanBlockWindow - 1);
    const addressTopic = topicForAddress(manualPayment.address);
    const candidates = [];
    let finalLastScannedBlock = scanToBlock;
    let finalNextBlock = scanToBlock + 1;

    for (const quote of quotes) {
      const assetConfig = this.config.assets[quote.asset];
      const tokenAddress = assetConfig?.addresses?.[chain] ? normalizeAddress(assetConfig.addresses[chain]) : '';
      if (!tokenAddress) continue;
      const logResult = await this.getLogsWithRangeRecovery({
        provider,
        tokenAddress,
        addressTopic,
        fromBlock,
        toBlock: scanToBlock,
        latestBlock,
        confirmedToBlock
      });
      latestBlock = logResult.latestBlock;
      confirmedToBlock = logResult.confirmedToBlock;
      if (!logResult.ok) {
        scanState[chain] = {
          ...chainState,
          latestBlock,
          nextBlock: fromBlock,
          lastScanAt: nowIso()
        };
        if (logResult.wait) {
          delete scanState[chain].error;
        } else {
          scanState[chain].error = logResult.error.message;
        }
        this.store.update('checkouts', checkout.id, {
          manualPayment: { ...manualPayment, scanState }
        });
        return this.store.getById('checkouts', checkout.id) || checkout;
      }
      const logs = logResult.logs;
      scanToBlock = logResult.toBlock;
      finalLastScannedBlock = scanToBlock;
      finalNextBlock = scanToBlock + 1;
      for (const log of sortLogs(logs)) {
        const observedAmountBaseUnits = BigInt(log.data || '0x0');
        const expectedAmountBaseUnits = BigInt(quote.cryptoAmountBaseUnits);
        if (observedAmountBaseUnits < expectedAmountBaseUnits) continue;
        candidates.push({
          quote,
          tokenAddress,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          observedAmountBaseUnits,
          fromAddress: topicAddress(log.topics?.[1])
        });
      }
    }

    scanState[chain] = {
      ...chainState,
      latestBlock,
      lastScannedBlock: finalLastScannedBlock,
      nextBlock: finalNextBlock,
      lastScanAt: nowIso()
    };
    delete scanState[chain].error;

    if (!candidates.length) {
      this.store.update('checkouts', checkout.id, {
        manualPayment: { ...manualPayment, scanState }
      });
      return this.store.getById('checkouts', checkout.id) || checkout;
    }

    const detected = candidates.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return routeScore(a.quote) - routeScore(b.quote);
    })[0];

    let payment;
    try {
      payment = await recordManualDetectedPayment({
        store: this.store,
        config: this.config,
        checkout,
        quote: detected.quote,
        txHash: detected.txHash,
        walletAddress: detected.fromAddress,
        recipientAddress: manualPayment.address,
        observedAmountBaseUnits: detected.observedAmountBaseUnits.toString(),
        tokenAddress: detected.tokenAddress,
        blockNumber: detected.blockNumber,
        confirmations: Math.max(1, latestBlock - detected.blockNumber + 1)
      });
    } catch (err) {
      this.store.update('checkouts', checkout.id, {
        manualPayment: {
          ...manualPayment,
          scanState,
          lastScanError: err.message,
          lastScanAt: nowIso()
        }
      });
      return this.store.getById('checkouts', checkout.id) || checkout;
    }
    let sweep = payment.sweep || null;
    if (!sweep || !sweep.status) {
      sweep = {
        status: this.pendingSweepStatus(),
        mode: this.sweepMode,
        updatedAt: nowIso()
      };
      payment = this.store.update('payments', payment.id, { sweep });
    }

    this.store.update('checkouts', checkout.id, {
      manualPayment: {
        ...manualPayment,
        status: 'payment_detected',
        detectedAt: nowIso(),
        detectedChain: detected.quote.chain,
        detectedAsset: detected.quote.asset,
        detectedTxHash: detected.txHash,
        detectedAmountBaseUnits: detected.observedAmountBaseUnits.toString(),
        scanState,
        sweepStatus: sweep.status || manualPayment.sweepStatus || this.pendingSweepStatus()
      }
    });

    return this.store.getById('checkouts', checkout.id) || checkout;
  }

  async getLogsWithRangeRecovery({ provider, tokenAddress, addressTopic, fromBlock, toBlock, latestBlock, confirmedToBlock }) {
    let rangeEnd = toBlock;
    let observedLatestBlock = latestBlock;
    let observedConfirmedToBlock = confirmedToBlock;
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const logs = await provider.getLogs({
          address: tokenAddress,
          topics: [TRANSFER_TOPIC, null, addressTopic],
          fromBlock,
          toBlock: rangeEnd
        });
        return {
          ok: true,
          logs,
          toBlock: rangeEnd,
          latestBlock: observedLatestBlock,
          confirmedToBlock: observedConfirmedToBlock
        };
      } catch (err) {
        lastError = err;
        observedLatestBlock = await provider.getBlockNumber().catch(() => observedLatestBlock);
        observedConfirmedToBlock = Math.max(0, observedLatestBlock - Math.max(0, this.config.minConfirmations - 1));
        if (fromBlock > observedConfirmedToBlock) {
          return {
            ok: false,
            wait: true,
            error: err,
            latestBlock: observedLatestBlock,
            confirmedToBlock: observedConfirmedToBlock
          };
        }
        if (attempt === 3) {
          break;
        }

        const maxRangeEnd = Math.min(rangeEnd - 1, observedConfirmedToBlock);
        if (maxRangeEnd < fromBlock) {
          return {
            ok: false,
            wait: true,
            error: err,
            latestBlock: observedLatestBlock,
            confirmedToBlock: observedConfirmedToBlock
          };
        }

        const currentSpan = Math.max(1, rangeEnd - fromBlock);
        const reducedSpan = Math.floor(currentSpan / 2);
        rangeEnd = Math.min(maxRangeEnd, fromBlock + reducedSpan);
      }
    }

    return {
      ok: false,
      wait: false,
      error: lastError || new Error('manual_payment_log_scan_failed'),
      latestBlock: observedLatestBlock,
      confirmedToBlock: observedConfirmedToBlock
    };
  }

  async processSweepQueue() {
    if (!this.isConfigured() || !this.canAutoSweep()) return;
    const pending = this.store.find('payments', (payment) => payment.method === 'manual' && payment.status === 'confirmed' && payment.txHash && payment.sweep?.status !== 'confirmed');
    for (const payment of pending) {
      try {
        await this.sweepPayment(payment);
      } catch (err) {
        const checkout = this.store.getById('checkouts', payment.checkoutId);
        this.store.update('payments', payment.id, {
          sweep: {
            ...(payment.sweep || {}),
            status: 'failed',
            error: err.message,
            updatedAt: nowIso()
          }
        });
        if (checkout?.manualPayment) {
          this.store.update('checkouts', checkout.id, {
            manualPayment: {
              ...(checkout.manualPayment || {}),
              sweepStatus: 'failed',
              lastSweepError: err.message,
              updatedAt: nowIso()
            }
          });
        }
      }
    }
  }

  async sweepPayment(payment) {
    const checkout = this.store.getById('checkouts', payment.checkoutId);
    if (!checkout?.manualPayment?.available) return;
    const chain = payment.chain;
    const asset = payment.asset;
    const treasuryAddress = checkout.recipientByChain?.[chain];
    const derivationIndex = checkout.manualPayment.derivationIndex;
    if (!treasuryAddress || !Number.isInteger(derivationIndex)) return;

    const provider = this.provider(chain);
    const assetConfig = this.config.assets[asset];
    if (!assetConfig || assetConfig.type !== 'erc20') {
      this.store.update('payments', payment.id, {
        sweep: {
          ...(payment.sweep || {}),
          status: 'unsupported',
          error: 'manual sweep only supports ERC-20 assets',
          updatedAt: nowIso()
        }
      });
      return;
    }

    const tokenAddress = normalizeAddress(assetConfig.addresses?.[chain]);
    const childWallet = this.deriveWallet(derivationIndex, chain);
    const fromAddress = childWallet.address;
    const tokenReader = new Contract(tokenAddress, ERC20_ABI, provider);
    const tokenBalance = BigInt(await tokenReader.balanceOf(fromAddress));
    if (tokenBalance <= 0n) {
      this.store.update('payments', payment.id, {
        sweep: {
          ...(payment.sweep || {}),
          status: 'confirmed',
          sweptAt: nowIso(),
          amountBaseUnits: '0',
          updatedAt: nowIso()
        }
      });
      return;
    }

    const feeData = await provider.getFeeData().catch(() => null);
    const feeOverrides = feeData ? this.feeOverrides(feeData) : null;
    const txRequest = await tokenReader.transfer.populateTransaction(treasuryAddress, tokenBalance);
    const gasLimit = BigInt(await provider.estimateGas({
      from: fromAddress,
      to: tokenAddress,
      data: txRequest.data
    }));

    if (this.sweepMode === 'external_signer') {
      const sweepResult = await this.requestExternalSweep({
        payment,
        checkout,
        chain,
        derivationIndex,
        fromAddress,
        treasuryAddress,
        tokenAddress,
        tokenBalance,
        gasLimit,
        feeOverrides
      });
      this.store.update('payments', payment.id, {
        sweep: {
          status: 'confirmed',
          mode: 'external_signer',
          fundingTxHash: sweepResult.fundingTxHash || '',
          txHash: sweepResult.txHash,
          amountBaseUnits: tokenBalance.toString(),
          treasuryAddress,
          sweptAt: nowIso(),
          updatedAt: nowIso()
        }
      });

      this.store.update('checkouts', checkout.id, {
        manualPayment: {
          ...(checkout.manualPayment || {}),
          sweepStatus: 'confirmed',
          sweptAt: nowIso(),
          sweepTxHash: sweepResult.txHash,
          fundingTxHash: sweepResult.fundingTxHash || ''
        }
      });
      return;
    }

    if (this.sweepMode !== 'local') {
      this.store.update('payments', payment.id, {
        sweep: {
          ...(payment.sweep || {}),
          status: 'manual_required',
          mode: 'manual',
          amountBaseUnits: tokenBalance.toString(),
          treasuryAddress,
          updatedAt: nowIso()
        }
      });
      this.store.update('checkouts', checkout.id, {
        manualPayment: {
          ...(checkout.manualPayment || {}),
          sweepStatus: 'manual_required',
          updatedAt: nowIso()
        }
      });
      return;
    }

    const sponsorWallet = new Wallet(this.sponsorPrivateKey, provider);
    const requiredNative = ((gasLimit * feeOverrides.unitPrice) * 12n) / 10n;
    const currentNative = await provider.getBalance(fromAddress);
    let fundingTxHash = payment.sweep?.fundingTxHash || null;

    if (currentNative < requiredNative) {
      const topUpAmount = requiredNative - currentNative;
      const fundingTx = await sponsorWallet.sendTransaction({
        to: fromAddress,
        value: topUpAmount,
        ...feeOverrides.tx
      });
      fundingTxHash = fundingTx.hash;
      await fundingTx.wait(this.config.minConfirmations);
    }

    const signerWallet = this.deriveWallet(derivationIndex, chain);
    const sweepTx = await signerWallet.sendTransaction({
      to: tokenAddress,
      data: txRequest.data,
      gasLimit,
      ...feeOverrides.tx
    });
    await sweepTx.wait(this.config.minConfirmations);

    this.store.update('payments', payment.id, {
      sweep: {
        status: 'confirmed',
        fundingTxHash,
        txHash: sweepTx.hash,
        amountBaseUnits: tokenBalance.toString(),
        treasuryAddress,
        sweptAt: nowIso(),
        updatedAt: nowIso()
      }
    });

    this.store.update('checkouts', checkout.id, {
      manualPayment: {
        ...(checkout.manualPayment || {}),
        sweepStatus: 'confirmed',
        sweptAt: nowIso(),
        sweepTxHash: sweepTx.hash,
        fundingTxHash: fundingTxHash || ''
      }
    });
  }

  feeOverrides(feeData) {
    if (feeData?.maxFeePerGas != null && feeData?.maxPriorityFeePerGas != null) {
      return {
        unitPrice: BigInt(feeData.maxFeePerGas),
        tx: {
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
        }
      };
    }
    if (feeData?.gasPrice != null) {
      return {
        unitPrice: BigInt(feeData.gasPrice),
        tx: { gasPrice: feeData.gasPrice }
      };
    }
    throw new Error('fee_data_unavailable');
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      const pendingCheckouts = this.store.find('checkouts', (checkout) => checkout.status !== 'paid' && checkout.manualPayment?.available)
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      const seenAddresses = new Set();
      for (const checkout of pendingCheckouts) {
        const manualAddress = String(checkout.manualPayment?.address || '').toLowerCase();
        if (manualAddress) {
          if (seenAddresses.has(manualAddress)) {
            this.store.update('checkouts', checkout.id, {
              manualPayment: {
                ...(checkout.manualPayment || {}),
                available: false,
                status: 'disabled',
                reason: 'duplicate_manual_address_detected',
                updatedAt: nowIso()
              }
            });
            continue;
          }
          seenAddresses.add(manualAddress);
        }
        try {
          await this.reconcileCheckout(checkout);
        } catch (err) {
          this.store.update('checkouts', checkout.id, {
            manualPayment: {
              ...(checkout.manualPayment || {}),
              lastScanError: err.message,
              lastScanAt: nowIso()
            }
          });
        }
      }
      if (this.canAutoSweep()) {
        try {
          await this.processSweepQueue();
        } catch (err) {
          console.error('manual_payment_sweep_error', err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer || !this.isConfigured()) return;
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => console.error('manual_payment_cycle_error', err));
    }, this.scanIntervalMs);
    this.runCycle().catch((err) => console.error('manual_payment_cycle_error', err));
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

ManualPaymentService.prototype.requestExternalSweep = async function requestExternalSweep({
  payment,
  checkout,
  chain,
  derivationIndex,
  fromAddress,
  treasuryAddress,
  tokenAddress,
  tokenBalance,
  gasLimit,
  feeOverrides
}) {
  const body = JSON.stringify({
    action: 'sweep_erc20',
    chain,
    derivationPath: this.derivationPath,
    derivationIndex,
    fromAddress,
    toAddress: treasuryAddress,
    tokenAddress,
    amountBaseUnits: tokenBalance.toString(),
    gasLimit: gasLimit.toString(),
    checkoutId: checkout.id,
    paymentId: payment.id,
    minConfirmations: this.config.minConfirmations,
    fee: feeOverrides?.tx
      ? Object.fromEntries(Object.entries(feeOverrides.tx).map(([key, value]) => [key, value.toString()]))
      : {}
  });
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  };
  if (this.sweepSignerSecret) headers.authorization = `Bearer ${this.sweepSignerSecret}`;
  const response = await requestJson(this.sweepSignerUrl, {
    body,
    headers,
    timeoutMs: this.config.webhookTimeoutMs
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`external_sweeper_http_${response.statusCode}`);
  }
  const payload = response.body || {};
  const txHash = String(payload.txHash || payload.sweepTxHash || '').trim();
  if (!txHash) throw new Error('external_sweeper_missing_tx_hash');
  return {
    txHash,
    fundingTxHash: String(payload.fundingTxHash || '').trim()
  };
};

module.exports = { ManualPaymentService };
