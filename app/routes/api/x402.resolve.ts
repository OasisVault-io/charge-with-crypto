import { getAppContext } from '../../lib/runtime'
import { json, x402ErrorResponse } from '../../lib/utils/api'

export async function action({ request }: { request: Request }) {
  try {
    const result = await getAppContext().x402Service.resolveRequest(request)
    return json(result.body, { status: result.status, headers: result.headers })
  } catch (error) {
    return x402ErrorResponse(error)
  }
}
