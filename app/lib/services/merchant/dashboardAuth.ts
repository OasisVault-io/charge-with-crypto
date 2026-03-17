import { type StatusError } from '../shared/types'

function reqHeader(req, name) {
	return req.headers?.[name] || req.headers?.[name.toLowerCase()] || null
}

function configuredAppMode(config) {
	const candidate = String(
		config?.appMode || (config?.env === 'production' ? 'production' : 'demo'),
	)
		.trim()
		.toLowerCase()
	return candidate === 'production' ? 'production' : 'demo'
}

function dashboardRequestAuthenticated(req, config) {
	if (!config.dashboardToken) return false
	const provided = String(reqHeader(req, 'x-dashboard-token') || '')
	return Boolean(provided && provided === config.dashboardToken)
}

function requireDashboardAuth(req, config) {
	if (!config.dashboardToken) return
	const provided = String(reqHeader(req, 'x-dashboard-token') || '')
	if (provided && provided === config.dashboardToken) return
	const err = new Error('dashboard_auth_required') as StatusError
	err.statusCode = 401
	throw err
}

function merchantAllowsPublicCheckout(merchant) {
	return Boolean(merchant?.publicCheckoutAllowed)
}

function directCheckoutAccess({ req, config, merchant, body }) {
	const authenticated =
		Boolean(config.dashboardToken) && dashboardRequestAuthenticated(req, config)
	if (configuredAppMode(config) === 'production') {
		if (authenticated) return null
		return {
			status: 403,
			body: {
				error: 'direct_checkout_creation_disabled',
				message:
					'Public checkout creation is disabled in production mode. Use POST /api/checkouts/resolve or authenticate the dashboard request.',
			},
		}
	}

	if (authenticated) return null
	if (!merchantAllowsPublicCheckout(merchant)) {
		return {
			status: 403,
			body: {
				error: 'public_checkout_unavailable',
				message:
					'This merchant does not allow unauthenticated public checkout creation.',
			},
		}
	}

	const blockedField = ['referenceId', 'successUrl', 'cancelUrl'].find(
		(field) => body?.[field] != null && body[field] !== '',
	)
	if (blockedField) {
		return {
			status: 400,
			body: {
				error: `${blockedField}_not_allowed_in_public_demo`,
				message: `${blockedField} is not available for public demo checkout creation.`,
			},
		}
	}

	return null
}

function redactMerchant(merchant, { includeBitcoinXpub = false } = {}) {
	if (!merchant) return null
	const { webhookSecret, bitcoinXpub, ...safe } = merchant
	if (includeBitcoinXpub && bitcoinXpub) safe.bitcoinXpub = bitcoinXpub
	return safe
}

export {
	configuredAppMode,
	dashboardRequestAuthenticated,
	directCheckoutAccess,
	redactMerchant,
	requireDashboardAuth,
}
