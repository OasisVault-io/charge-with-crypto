import { json } from '../lib/utils/api'
import { getMcpInfo, handleMcp } from '../lib/services/mcpService'

export async function loader() {
	return json(getMcpInfo())
}

export async function action({ request }: { request: Request }) {
	const result = await handleMcp(request)
	return json(result.body, { status: result.status })
}
