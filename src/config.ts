// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const { requireOptionalString } = require('./utils/validation');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const projectRootCandidates = [
  path.resolve(__dirname, '..'),
  path.resolve(__dirname, '..', '..', '..')
];
const projectRoot = projectRootCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'config', 'chains.json'))) || path.resolve(__dirname, '..');
loadEnv(path.join(projectRoot, '.env'));

const chainsConfigPath = path.join(projectRoot, 'config', 'chains.json');
const chainsConfig = JSON.parse(fs.readFileSync(chainsConfigPath, 'utf8'));

function normalizeAppMode(value, env = 'development') {
  const fallback = env === 'production' ? 'production' : 'demo';
  const candidate = String(value || fallback).trim().toLowerCase();
  return candidate === 'production' ? 'production' : 'demo';
}

function validateRuntimeConfig(input) {
  const appMode = normalizeAppMode(input?.appMode, input?.env || 'development');
  if (appMode !== 'production') return;

  const dashboardToken = String(input?.dashboardToken || '').trim();
  if (!dashboardToken || dashboardToken === 'change_me_before_public_deploy') {
    throw new Error('DASHBOARD_TOKEN must be set to a non-default value when APP_MODE=production');
  }
}

const config = {
  env: process.env.NODE_ENV || 'development',
  appMode: normalizeAppMode(process.env.APP_MODE, process.env.NODE_ENV || 'development'),
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  dataDir: process.env.DATA_DIR || path.join(projectRoot, 'data'),
  quoteExpirySeconds: Number(process.env.QUOTE_EXPIRY_SECONDS || 120),
  bitcoinQuoteExpirySeconds: Number(process.env.BTC_QUOTE_EXPIRY_SECONDS || 120),
  webhookTimeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS || 3000),
  webhookRetries: Number(process.env.WEBHOOK_RETRIES || 3),
  webhookBackoffMs: Number(process.env.WEBHOOK_BACKOFF_MS || 1000),
  webhookSecretFallback: process.env.WEBHOOK_SECRET || 'dev_webhook_secret_change_me',
  dashboardToken: process.env.DASHBOARD_TOKEN || '',
  minConfirmations: Number(process.env.MIN_CONFIRMATIONS || 1),
  manualPaymentMnemonic: process.env.MANUAL_PAYMENT_MNEMONIC || '',
  manualPaymentDerivationPath: process.env.MANUAL_PAYMENT_DERIVATION_PATH || "m/44'/60'/0'/0",
  manualPaymentSweepSponsorPrivateKey: process.env.MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY || '',
  manualPaymentScanIntervalMs: Number(process.env.MANUAL_PAYMENT_SCAN_INTERVAL_MS || 15000),
  manualPaymentScanBlockWindow: Number(process.env.MANUAL_PAYMENT_SCAN_BLOCK_WINDOW || 250),
  bitcoinEsploraBaseUrl: requireOptionalString(process.env.BTC_ESPLORA_BASE_URL || 'https://blockstream.info/api', 'BTC_ESPLORA_BASE_URL', { max: 240 }),
  chains: chainsConfig.chains,
  assets: chainsConfig.assets
};

validateRuntimeConfig(config);

module.exports = { config, projectRoot, normalizeAppMode, validateRuntimeConfig };
