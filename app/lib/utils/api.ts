import type { ZodType } from 'zod';

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

export function apiError(error: string, status = 400, message = '') {
  return json({ error, message: message || error }, { status });
}

export async function parseBody<T = Record<string, unknown>>(request: Request, schema?: ZodType<T>): Promise<T> {
  try {
    const text = await request.text();
    const parsed = !text ? {} : JSON.parse(text);
    if (!schema) return parsed as T;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw Object.assign(new Error(result.error.issues.map((issue) => issue.message).join('; ') || 'Invalid request body'), {
        statusCode: 400
      });
    }
    return result.data;
  } catch (_err) {
    if (_err?.statusCode) throw _err;
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

export function requestHeader(request: Request, name: string) {
  return request.headers.get(name) || request.headers.get(name.toLowerCase()) || null;
}
