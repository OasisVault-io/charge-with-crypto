import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { hmacSha256 } from '../../utils/crypto'
import { nowIso } from '../../utils/time'
import {
	repositoriesFrom,
	type ServiceRepositories,
} from '../shared/repositories'
import {
	type AppConfig,
	type EventLike,
	type MerchantLike,
	type StoreLike,
} from '../shared/types'

type RequestOnceResponse = {
	statusCode: number
	body: string
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function eventPayload(event: EventLike) {
	return JSON.stringify({
		id: event.id,
		type: event.type,
		createdAt: event.createdAt,
		data: event.data,
	})
}

async function deliverWebhook({
	repositories: providedRepositories,
	store,
	config,
	merchant,
	event,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
	config: AppConfig
	merchant: MerchantLike
	event: EventLike
}) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	const endpoint = merchant.webhookUrl
	if (!endpoint) return { skipped: true, reason: 'missing_webhook_url' }

	const body = eventPayload(event)
	const timestamp = Math.floor(Date.now() / 1000)
	const secret = merchant.webhookSecret || config.webhookSecretFallback
	const signature = hmacSha256(secret, `${timestamp}.${body}`)
	const deliveryRecord = repositories.webhookDeliveries.insert({
		merchantId: merchant.id,
		eventId: event.id,
		endpoint,
		status: 'pending',
		attempts: 0,
		nextRetryAt: null,
		lastAttemptAt: null,
		signature,
		timestamp,
	})

	if (endpoint.startsWith('mock://')) {
		repositories.webhookDeliveries.update(deliveryRecord.id, {
			status: 'delivered',
			attempts: 1,
			lastAttemptAt: nowIso(),
			responseCode: 200,
			responseBody: 'mock-delivered',
		})
		return { delivered: true, responseCode: 200, signature }
	}

	let lastErr: Error | null = null
	for (let attempt = 1; attempt <= config.webhookRetries; attempt += 1) {
		try {
			const response = await requestOnce(
				endpoint,
				body,
				signature,
				timestamp,
				config.webhookTimeoutMs,
			)
			const success = response.statusCode >= 200 && response.statusCode < 300
			repositories.webhookDeliveries.update(deliveryRecord.id, {
				status: success ? 'delivered' : 'failed',
				attempts: attempt,
				lastAttemptAt: nowIso(),
				nextRetryAt:
					success || attempt === config.webhookRetries
						? null
						: new Date(
								Date.now() + config.webhookBackoffMs * attempt,
							).toISOString(),
				responseCode: response.statusCode,
				responseBody: response.body,
			})
			if (success) {
				return {
					delivered: true,
					responseCode: response.statusCode,
					signature,
				}
			}
			lastErr = new Error(`Webhook returned ${response.statusCode}`)
		} catch (error) {
			lastErr = error instanceof Error ? error : new Error('delivery_failed')
			repositories.webhookDeliveries.update(deliveryRecord.id, {
				status: 'failed',
				attempts: attempt,
				lastAttemptAt: nowIso(),
				nextRetryAt:
					attempt === config.webhookRetries
						? null
						: new Date(
								Date.now() + config.webhookBackoffMs * attempt,
							).toISOString(),
				error: lastErr.message,
			})
		}

		if (attempt < config.webhookRetries) {
			await sleep(config.webhookBackoffMs * attempt)
		}
	}

	return {
		delivered: false,
		error: lastErr ? lastErr.message : 'delivery_failed',
		signature,
	}
}

function dispatchWebhook(
	args: {
		repositories?: ServiceRepositories
		store?: StoreLike
		config: AppConfig
		merchant: MerchantLike
		event: EventLike
	},
	logger: Pick<Console, 'error'> = console,
) {
	return deliverWebhook(args).catch((error) => {
		const err = error instanceof Error ? error : new Error('delivery_failed')
		logger.error?.('webhook_delivery_error', {
			merchantId: args.merchant.id,
			eventId: args.event.id,
			message: err.message,
		})
		return { delivered: false, error: err.message }
	})
}

function requestOnce(
	endpoint: string,
	body: string,
	signature: string,
	timestamp: number,
	timeoutMs: number,
) {
	return new Promise<RequestOnceResponse>((resolve, reject) => {
		const url = new URL(endpoint)
		const transport = url.protocol === 'https:' ? https : http

		const req = transport.request(
			{
				method: 'POST',
				hostname: url.hostname,
				port: url.port,
				path: `${url.pathname}${url.search}`,
				timeout: timeoutMs,
				headers: {
					'content-type': 'application/json',
					'x-charge-with-crypto-signature': `t=${timestamp},v1=${signature}`,
					'x-charge-with-crypto-timestamp': String(timestamp),
					'x-charge-with-crypto-event': 'payment.confirmed',
					'content-length': Buffer.byteLength(body),
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
				res.on('end', () =>
					resolve({
						statusCode: res.statusCode || 0,
						body: Buffer.concat(chunks).toString('utf8'),
					}),
				)
			},
		)

		req.on('timeout', () => req.destroy(new Error('webhook_timeout')))
		req.on('error', reject)
		req.write(body)
		req.end()
	})
}

export { deliverWebhook, dispatchWebhook, eventPayload }
