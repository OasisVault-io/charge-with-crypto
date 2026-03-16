// @ts-nocheck
import { createRequire } from 'node:module';

const requireBase = typeof __filename === 'string' ? __filename : `${process.cwd()}/src/appContext.ts`;
const localRequire = createRequire(requireBase);
const { config, validateRuntimeConfig } = localRequire('./config');
const { SqliteStore } = localRequire('./store/sqliteStore');
const { ProviderRegistry } = localRequire('./services/provider');
const { EvmVerifier } = localRequire('./services/evmVerifier');
const { BitcoinVerifier } = localRequire('./services/bitcoinVerifier');
const { ensureMerchantDefaults } = localRequire('./routes/api');
const { PriceService } = localRequire('./services/priceService');
const { BalanceService } = localRequire('./services/balanceService');
const { ManualPaymentService } = localRequire('./services/manualPaymentService');
const { BitcoinManualPaymentService } = localRequire('./services/bitcoinManualPaymentService');
const { CompositeManualPaymentService } = localRequire('./services/compositeManualPaymentService');
const { BitcoinAddressService } = localRequire('./services/bitcoinAddressService');
const { X402Service } = localRequire('./services/x402Service');
const { McpService } = localRequire('./services/mcpService');

function createAppContext(customConfig = config) {
  validateRuntimeConfig(customConfig);

  const store = new SqliteStore(customConfig.dataDir);
  ensureMerchantDefaults(store, customConfig);

  const providers = new ProviderRegistry();
  Object.keys(customConfig.chains).forEach((chain) => {
    if (chain === 'bitcoin') {
      providers.register(chain, new BitcoinVerifier({ config: customConfig, minConfirmations: customConfig.minConfirmations }));
      return;
    }
    providers.register(chain, new EvmVerifier({ config: customConfig, chain, minConfirmations: customConfig.minConfirmations }));
  });

  const priceService = new PriceService({ config: customConfig });
  const balanceService = new BalanceService({ config: customConfig });
  const evmManualPaymentService = new ManualPaymentService({ store, config: customConfig });
  const bitcoinManualPaymentService = new BitcoinManualPaymentService({ store, config: customConfig });
  const manualPaymentService = new CompositeManualPaymentService({
    evmService: evmManualPaymentService,
    bitcoinService: bitcoinManualPaymentService
  });
  const bitcoinAddressService = new BitcoinAddressService({ store, config: customConfig });
  const x402Service = new X402Service({
    store,
    config: customConfig,
    priceService,
    manualPaymentService,
    bitcoinAddressService
  });
  const mcpService = new McpService({
    store,
    config: customConfig,
    priceService,
    manualPaymentService,
    bitcoinAddressService,
    x402Service
  });

  return {
    config: customConfig,
    store,
    providers,
    priceService,
    balanceService,
    manualPaymentService,
    bitcoinAddressService,
    x402Service,
    mcpService
  };
}

function startAppContext(context) {
  context.manualPaymentService.start();
  context.x402Service?.initialize?.().catch((err) => {
    console.error('x402_init_error', err);
  });
  return context;
}

function stopAppContext(context) {
  context.manualPaymentService.stop();
}

module.exports = {
  createAppContext,
  startAppContext,
  stopAppContext
};

export { createAppContext, startAppContext, stopAppContext };
