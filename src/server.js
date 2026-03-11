const http = require('node:http');
const path = require('node:path');
const { config, projectRoot } = require('./config');
const { SqliteStore } = require('./store/sqliteStore');
const { ProviderRegistry } = require('./services/provider');
const { EvmVerifier } = require('./services/evmVerifier');
const { sendFile, sendJson, sendText } = require('./utils/http');
const { handleApi, ensureMerchantDefaults } = require('./routes/api');
const { PriceService } = require('./services/priceService');
const { BalanceService } = require('./services/balanceService');
const { ManualPaymentService } = require('./services/manualPaymentService');

const publicDir = path.join(projectRoot, 'public');

function createApp(customConfig = config) {
  const store = new SqliteStore(customConfig.dataDir);
  ensureMerchantDefaults(store, customConfig);

  const providers = new ProviderRegistry();
  Object.keys(customConfig.chains).forEach((chain) => {
    providers.register(chain, new EvmVerifier({ config: customConfig, chain, minConfirmations: customConfig.minConfirmations }));
  });

  const priceService = new PriceService({ config: customConfig });
  const balanceService = new BalanceService({ config: customConfig });
  const manualPaymentService = new ManualPaymentService({ store, config: customConfig });

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return sendText(res, 400, 'Bad Request');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('x-frame-options', 'DENY');
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
      res.setHeader('content-security-policy', "default-src 'self'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

      if (req.url.startsWith('/api/')) {
        const handled = await handleApi(req, res, { store, config: customConfig, providers, priceService, balanceService, manualPaymentService });
        if (handled === false) sendJson(res, 404, { error: 'api route not found' });
        return;
      }

      if (req.url === '/' || req.url.startsWith('/?')) {
        sendFile(res, path.join(publicDir, 'index.html'));
        return;
      }

      const filePath = path.join(publicDir, req.url.split('?')[0]);
      if (filePath.startsWith(publicDir) && sendFile(res, filePath)) return;

      sendText(res, 404, 'Not Found');
    } catch (err) {
      sendJson(res, err.statusCode || 500, { error: err.statusCode ? err.message : 'internal_error', message: err.message });
    }
  });

  return { server, store, manualPaymentService };
}

function start() {
  const { server, manualPaymentService } = createApp(config);
  server.on('error', (err) => {
    console.error('server_start_error', err);
    process.exit(1);
  });
  server.on('close', () => manualPaymentService.stop());
  server.listen(config.port, '0.0.0.0', () => {
    manualPaymentService.start();
    console.log(`Charge With Crypto listening on ${config.baseUrl}`);
  });
}

if (require.main === module) start();

module.exports = { createApp };
