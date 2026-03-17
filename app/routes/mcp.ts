import { getAppContext } from '../lib/runtime'
import { json } from '../lib/utils/api'

export async function loader() {
  return json(getAppContext().mcpService.info())
}

export async function action({ request }: { request: Request }) {
  const result = await getAppContext().mcpService.handleRequest(request)
  return json(result.body, { status: result.status })
}
