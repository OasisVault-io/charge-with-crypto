import { json } from '../../lib/utils/api'
import { resolveX402 } from '../../lib/services/x402Service'

export async function action({ request }: { request: Request }) {
	try {
		const result = await resolveX402(request)
		return json(result.body, { status: result.status, headers: result.headers })
	} catch (err: any) {
		return json(
			{
				error: err.code || err.message || 'x402_error',
				message: err.message,
			},
			{ status: err.statusCode || 500 },
		)
	}
}
