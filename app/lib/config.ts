// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

const projectRootCandidates = [process.cwd(), path.resolve(process.cwd(), '..')]
const projectRoot =
  projectRootCandidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'config', 'chains.json')),
  ) || process.cwd()
loadEnv(path.join(projectRoot, '.env'))

const chainsConfigPath = path.join(projectRoot, 'config', 'chains.json')
const chainsConfig = JSON.parse(fs.readFileSync(chainsConfigPath, 'utf8'))

const stringOrDefault = (fallback) => z.string().trim().default(fallback)
const urlString = (fallback) => z.string().trim().url().default(fallback)
const optionalTrimmed = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => value || '')
const integerDefault = (fallback) => z.coerce.number().int().default(fallback)
const csvString = (fallback) =>
  z
    .string()
    .trim()
    .default(fallback)
    .transform((value) => [
      ...new Set(
        String(value || '')
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean),
      ),
    ])
const booleanish = (fallback = false) =>
  z.preprocess((value) => {
    if (value == null || value === '') return fallback
    const candidate = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(candidate)) return true
    if (['0', 'false', 'no', 'off'].includes(candidate)) return false
    return fallback
  }, z.boolean())

function normalizeAppMode(value, env = 'development') {
  const fallback = env === 'production' ? 'production' : 'demo'
  const candidate = String(value || fallback)
    .trim()
    .toLowerCase()
  return candidate === 'production' ? 'production' : 'demo'
}

function validateRuntimeConfig(input) {
  const appMode = normalizeAppMode(input?.appMode, input?.env || 'development')
  if (appMode !== 'production') return

  const dashboardToken = String(input?.dashboardToken || '').trim()
  if (!dashboardToken || dashboardToken === 'change_me_before_public_deploy') {
    throw new Error(
      'DASHBOARD_TOKEN must be set to a non-default value when APP_MODE=production',
    )
  }

  if (input?.x402Enabled) {
    const apiKeyId = String(input?.cdpApiKeyId || '').trim()
    const apiKeySecret = String(input?.cdpApiKeySecret || '').trim()
    if (!apiKeyId || !apiKeySecret) {
      throw new Error(
        'CDP_API_KEY_ID and CDP_API_KEY_SECRET must be set when X402 is enabled in production',
      )
    }
  }
}

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  const candidate = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(candidate)) return true
  if (['0', 'false', 'no', 'off'].includes(candidate)) return false
  return fallback
}

const rawEnvSchema = z.object({
  NODE_ENV: stringOrDefault('development'),
  APP_MODE: z.string().trim().optional(),
  PORT: integerDefault(3000),
  BASE_URL: urlString('http://localhost:3000'),
  DATA_DIR: z.string().trim().optional(),
  QUOTE_EXPIRY_SECONDS: integerDefault(120),
  BTC_QUOTE_EXPIRY_SECONDS: integerDefault(120),
  WEBHOOK_TIMEOUT_MS: integerDefault(3000),
  WEBHOOK_RETRIES: integerDefault(3),
  WEBHOOK_BACKOFF_MS: integerDefault(1000),
  WEBHOOK_SECRET: stringOrDefault('dev_webhook_secret_change_me'),
  DASHBOARD_TOKEN: optionalTrimmed(),
  MIN_CONFIRMATIONS: integerDefault(1),
  MANUAL_PAYMENT_XPUB: optionalTrimmed(),
  MANUAL_PAYMENT_MNEMONIC: optionalTrimmed(),
  MANUAL_PAYMENT_DERIVATION_PATH: stringOrDefault("m/44'/60'/0'/0"),
  MANUAL_PAYMENT_ALLOWED_CHAINS: csvString('base,ethereum'),
  MANUAL_PAYMENT_START_INDEX: integerDefault(0),
  MANUAL_PAYMENT_SWEEP_SIGNER_URL: optionalTrimmed(),
  MANUAL_PAYMENT_SWEEP_SIGNER_SECRET: optionalTrimmed(),
  MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY: optionalTrimmed(),
  MANUAL_PAYMENT_SCAN_INTERVAL_MS: integerDefault(15000),
  MANUAL_PAYMENT_SCAN_BLOCK_WINDOW: integerDefault(250),
  BTC_ESPLORA_BASE_URL: urlString('https://blockstream.info/api'),
  CDP_API_KEY_ID: optionalTrimmed(),
  CDP_API_KEY_SECRET: optionalTrimmed(),
  X402_ENABLED: booleanish(false),
  X402_FACILITATOR_URL: optionalTrimmed(),
  X402_BASE_NETWORK: stringOrDefault('eip155:8453'),
  X402_BASE_ASSET: stringOrDefault('USDC'),
})

function parseRuntimeEnv(env) {
  const parsed = rawEnvSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`invalid runtime env: ${issues}`)
  }
  return parsed.data
}

const parsedEnv = parseRuntimeEnv(process.env)

const config = {
  env: parsedEnv.NODE_ENV,
  appMode: normalizeAppMode(parsedEnv.APP_MODE, parsedEnv.NODE_ENV),
  port: parsedEnv.PORT,
  baseUrl: parsedEnv.BASE_URL,
  dataDir: parsedEnv.DATA_DIR || path.join(projectRoot, 'data'),
  quoteExpirySeconds: parsedEnv.QUOTE_EXPIRY_SECONDS,
  bitcoinQuoteExpirySeconds: parsedEnv.BTC_QUOTE_EXPIRY_SECONDS,
  webhookTimeoutMs: parsedEnv.WEBHOOK_TIMEOUT_MS,
  webhookRetries: parsedEnv.WEBHOOK_RETRIES,
  webhookBackoffMs: parsedEnv.WEBHOOK_BACKOFF_MS,
  webhookSecretFallback: parsedEnv.WEBHOOK_SECRET,
  dashboardToken: parsedEnv.DASHBOARD_TOKEN,
  minConfirmations: parsedEnv.MIN_CONFIRMATIONS,
  manualPaymentXpub: parsedEnv.MANUAL_PAYMENT_XPUB,
  manualPaymentMnemonic: parsedEnv.MANUAL_PAYMENT_MNEMONIC,
  manualPaymentDerivationPath: parsedEnv.MANUAL_PAYMENT_DERIVATION_PATH,
  manualPaymentAllowedChains: parsedEnv.MANUAL_PAYMENT_ALLOWED_CHAINS,
  manualPaymentStartIndex: parsedEnv.MANUAL_PAYMENT_START_INDEX,
  manualPaymentSweepSignerUrl: parsedEnv.MANUAL_PAYMENT_SWEEP_SIGNER_URL,
  manualPaymentSweepSignerSecret: parsedEnv.MANUAL_PAYMENT_SWEEP_SIGNER_SECRET,
  manualPaymentSweepSponsorPrivateKey:
    parsedEnv.MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY,
  manualPaymentScanIntervalMs: parsedEnv.MANUAL_PAYMENT_SCAN_INTERVAL_MS,
  manualPaymentScanBlockWindow: parsedEnv.MANUAL_PAYMENT_SCAN_BLOCK_WINDOW,
  bitcoinEsploraBaseUrl: parsedEnv.BTC_ESPLORA_BASE_URL,
  cdpApiKeyId: parsedEnv.CDP_API_KEY_ID,
  cdpApiKeySecret: parsedEnv.CDP_API_KEY_SECRET,
  x402Enabled:
    parsedEnv.X402_ENABLED ||
    Boolean(parsedEnv.CDP_API_KEY_ID && parsedEnv.CDP_API_KEY_SECRET),
  x402FacilitatorUrl: parsedEnv.X402_FACILITATOR_URL,
  x402BaseNetwork: parsedEnv.X402_BASE_NETWORK,
  x402BaseAsset: parsedEnv.X402_BASE_ASSET,
  chains: chainsConfig.chains,
  assets: chainsConfig.assets,
}

validateRuntimeConfig(config)

export {
  config,
  projectRoot,
  normalizeAppMode,
  validateRuntimeConfig,
  normalizeBoolean,
}
