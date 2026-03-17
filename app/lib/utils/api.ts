import { type ZodType } from 'zod'
import {
  appErrorBody,
  badRequest,
  fromUnknownError,
  type AppError,
} from '../services/shared/appError'

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function apiError(error: string, status = 400, message = '') {
  return json({ error, message: message || error }, { status })
}

export function apiErrorResponse(
  error: unknown,
  {
    defaultStatus = 400,
    defaultCode = 'invalid_request',
    defaultMessage,
  }: {
    defaultStatus?: number
    defaultCode?: string
    defaultMessage?: string
  } = {},
) {
  const appError = fromUnknownError(error, {
    defaultStatus,
    defaultCode,
    defaultMessage: defaultMessage || defaultCode,
  })
  return json(appErrorBody(appError), {
    status: appError.status,
    headers: appError.headers,
  })
}

export function x402ErrorResponse(error: unknown) {
  const appError = fromUnknownError(error, {
    defaultStatus: 500,
    defaultCode: 'x402_error',
    defaultMessage: 'x402_error',
  })
  const body =
    appError.body && typeof appError.body === 'object'
      ? appError.body
      : {
          error: appError.code || appError.message || 'x402_error',
          message: appError.message,
        }
  return json(body, {
    status: appError.status,
    headers: appError.headers,
  })
}

export function mcpJsonRpcError(
  error: unknown,
  id: unknown,
  defaultCode = -32000,
) {
  const appError = fromUnknownError(error)
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: defaultCode,
      message: appError.message,
      data: {
        statusCode: appError.status,
        error: appError.code,
      },
    },
  }
}

export async function parseBody<T = Record<string, unknown>>(
  request: Request,
  schema?: ZodType<T>,
): Promise<T> {
  try {
    const text = await request.text()
    const parsed = !text ? {} : JSON.parse(text)
    if (!schema) return parsed as T
    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw badRequest(
        result.error.issues.map((issue) => issue.message).join('; ') ||
          'Invalid request body',
      )
    }
    return result.data
  } catch (error) {
    const appError = fromUnknownError(error, {
      defaultStatus: 400,
      defaultCode: 'invalid_json_body',
      defaultMessage: 'Invalid JSON body',
    })
    if (appError.status === 500) throw badRequest('Invalid JSON body')
    throw appError
  }
}

export function requestHeader(request: Request, name: string) {
  return (
    request.headers.get(name) || request.headers.get(name.toLowerCase()) || null
  )
}

export type { AppError }
