type X402HttpResponse = {
	status: number
	headers?: Record<string, string>
	body?: unknown
}

type X402ProcessedRequest = {
	type: string
	response: X402HttpResponse
	paymentPayload?: { payload?: Record<string, unknown> }
	paymentRequirements?: unknown
	declaredExtensions?: unknown
}

type X402SettlementResult = {
	success: boolean
	response: X402HttpResponse
	headers?: Record<string, string>
	errorReason?: string
	errorMessage?: string
	payer?: string
	transaction?: string
	network?: string
	extensions?: Record<string, unknown>
}

declare module '@x402/core/http' {
	export class x402HTTPResourceServer {
		constructor(resourceServer: unknown, routes: Record<string, unknown>)
		initialize(): Promise<void>
		processHTTPRequest(context: unknown): Promise<X402ProcessedRequest>
		processSettlement(
			paymentPayload: unknown,
			paymentRequirements: unknown,
			declaredExtensions: unknown,
			context: unknown,
		): Promise<X402SettlementResult>
	}
}

declare module '@x402/core/server' {
	export class HTTPFacilitatorClient {
		constructor(config?: unknown)
	}

	export class x402ResourceServer {
		constructor(client: HTTPFacilitatorClient)
		register(network: string, scheme: unknown): this
		registerExtension(extension: unknown): this
		initialize(): Promise<void>
	}
}

declare module '@x402/evm/exact/server' {
	export class ExactEvmScheme {
		constructor()
	}
}

declare module '@x402/extensions/bazaar' {
	export const bazaarResourceServerExtension: unknown
	export function declareDiscoveryExtension(input: unknown): unknown
}
