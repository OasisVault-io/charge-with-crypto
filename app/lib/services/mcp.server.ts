import { getAppContext } from '../server/runtime';
import { parseBody } from '../utils/api';

export function getMcpInfo() {
  return getAppContext().mcpService.info();
}

export async function handleMcp(request: Request) {
  const { mcpService } = getAppContext();
  const payload = await parseBody<Record<string, any>>(request);
  if (!payload || Array.isArray(payload) || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    return { status: 400, body: { jsonrpc: '2.0', id: payload?.id || null, error: { code: -32600, message: 'Invalid Request' } } };
  }

  if (payload.method === 'initialize') {
    return { status: 200, body: { jsonrpc: '2.0', id: payload.id ?? null, result: mcpService.initializeResult(payload.params?.protocolVersion) } };
  }

  if (payload.method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id: payload.id ?? null, result: { tools: mcpService.tools() } } };
  }

  if (payload.method === 'tools/call') {
    try {
      const result = await mcpService.callTool(payload.params?.name, payload.params?.arguments || {});
      return { status: 200, body: { jsonrpc: '2.0', id: payload.id ?? null, result } };
    } catch (err: any) {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: payload.id ?? null,
          error: { code: -32000, message: err.message, data: { statusCode: err.statusCode || 500 } }
        }
      };
    }
  }

  return { status: 200, body: { jsonrpc: '2.0', id: payload.id ?? null, error: { code: -32601, message: 'Method not found' } } };
}
