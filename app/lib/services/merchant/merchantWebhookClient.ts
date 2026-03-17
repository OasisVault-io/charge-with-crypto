import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { hmacSha256 } from '../../utils/crypto'
import { nowIso } from '../../utils/time'
import {
  type AnyRecord,
  type AppConfig,
  type MerchantLike,
  type ResolvedCheckoutLike,
} from '../shared/types'

function buildHeaders({
  signature,
  timestamp,
  body,
  eventType,
}: {
  signature: string
  timestamp: number | string
  body: string
  eventType: string
}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    'x-charge-with-crypto-signature': `t=${timestamp},v1=${signature}`,
    'x-charge-with-crypto-timestamp': String(timestamp),
    'x-charge-with-crypto-event': eventType,
  }
}

function requestJson(
  endpoint: string,
  {
    body,
    headers,
    timeoutMs,
  }: {
    body: string | Buffer
    headers: Record<string, string>
    timeoutMs?: number
  },
): Promise<{ statusCode: number; body: unknown; raw: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const transport = url.protocol === 'https:' ? https : http
    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        timeout: timeoutMs,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let parsed: unknown = null
          if (raw) {
            try {
              parsed = JSON.parse(raw)
            } catch (err) {
              const message =
                err instanceof Error ? err.message : String(err)
              reject(new Error(`merchant_webhook_invalid_json:${message}`))
              return
            }
          }
          resolve({ statusCode: res.statusCode || 0, body: parsed, raw })
        })
      },
    )

    req.on('timeout', () => req.destroy(new Error('merchant_webhook_timeout')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function resolveCheckoutFromMerchant({
  merchant,
  config,
  referenceId,
  planId = '',
}: {
  merchant: MerchantLike
  config: AppConfig
  referenceId: string
  planId?: string
}): Promise<ResolvedCheckoutLike> {
  if (!merchant?.webhookUrl) throw new Error('merchant missing webhook url')

  if (merchant.webhookUrl.startsWith('mock://')) {
    const selectedPlan = planId
      ? (merchant.plans || []).find((plan) => plan.id === planId) || null
      : null
    const paymentRail =
      selectedPlan?.paymentRail || merchant.defaultPaymentRail || 'evm'
    return {
      planId: selectedPlan?.id || planId || '',
      orderId: referenceId || 'resolved-order',
      title: selectedPlan?.title || 'Resolved plan',
      description:
        selectedPlan?.description || 'Loaded from merchant webhook response.',
      amountUsd: selectedPlan?.amountUsd || 25,
      paymentRail,
      acceptedAssets:
        selectedPlan?.acceptedAssets ||
        (paymentRail === 'bitcoin'
          ? ['BTC']
          : (merchant.defaultAcceptedAssets || ['USDC', 'USDT']).filter(
              (asset) => asset !== 'BTC',
            )),
      enabledChains:
        selectedPlan?.enabledChains ||
        (paymentRail === 'bitcoin'
          ? ['bitcoin']
          : (merchant.enabledChains || Object.keys(config.chains)).filter(
              (chain) => chain !== 'bitcoin',
            )),
    }
  }

  const payload = JSON.stringify({
    type: 'checkout.resolve',
    createdAt: nowIso(),
    data: {
      merchantId: merchant.id,
      referenceId,
      planId,
    },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const secret = merchant.webhookSecret || config.webhookSecretFallback
  const signature = hmacSha256(secret, `${timestamp}.${payload}`)
  const response = await requestJson(merchant.webhookUrl, {
    body: payload,
    headers: buildHeaders({
      signature,
      timestamp,
      body: payload,
      eventType: 'checkout.resolve',
    }),
    timeoutMs: config.webhookTimeoutMs,
  })

  const resolvedResponse = response as { statusCode: number; body?: AnyRecord }
  if (resolvedResponse.statusCode < 200 || resolvedResponse.statusCode >= 300) {
    throw new Error(`merchant_webhook_http_${resolvedResponse.statusCode}`)
  }

  const resolved = resolvedResponse.body?.checkout || resolvedResponse.body
  if (!resolved || typeof resolved !== 'object')
    throw new Error('merchant_webhook_empty_checkout')
  return resolved as ResolvedCheckoutLike
}

export { resolveCheckoutFromMerchant, requestJson, buildHeaders }
