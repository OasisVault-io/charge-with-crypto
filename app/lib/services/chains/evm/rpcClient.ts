import { type FetchLike } from '../../shared/types'

type JsonRpcResponse = {
  error?: {
    message?: string
  }
  result?: unknown
}

class RpcClient {
  endpoint: string
  timeoutMs: number
  fetchImpl: FetchLike
  nextId: number

  constructor(
    endpoint: string,
    {
      timeoutMs = 10000,
      fetchImpl = fetch,
    }: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
  ) {
    this.endpoint = endpoint
    this.timeoutMs = timeoutMs
    this.fetchImpl = fetchImpl
    this.nextId = 1
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method,
          params,
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`rpc_http_${response.status}`)
      const payload = (await response.json()) as JsonRpcResponse
      if (payload.error) throw new Error(payload.error.message || 'rpc_error')
      return payload.result
    } finally {
      clearTimeout(timer)
    }
  }
}

export { RpcClient }
