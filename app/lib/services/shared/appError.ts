import { type AnyRecord } from './types'

type AppErrorOptions = {
  status: number
  code?: string
  message?: string
  body?: unknown
  headers?: HeadersInit
  cause?: unknown
}

class AppError extends Error {
  status: number
  statusCode: number
  code: string
  body?: unknown
  headers?: HeadersInit
  override cause?: unknown

  constructor({
    status,
    code = 'internal_error',
    message = code,
    body,
    headers,
    cause,
  }: AppErrorOptions) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.statusCode = status
    this.code = code
    this.body = body
    this.headers = headers
    this.cause = cause
  }
}

function appError(options: AppErrorOptions) {
  return new AppError(options)
}

function badRequest(
  message = 'invalid_request',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 400,
    code: options.code || 'invalid_request',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function unauthorized(
  message = 'unauthorized',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 401,
    code: options.code || 'unauthorized',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function forbidden(
  message = 'forbidden',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 403,
    code: options.code || 'forbidden',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function notFound(
  message = 'not_found',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 404,
    code: options.code || 'not_found',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function conflict(
  message = 'conflict',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 409,
    code: options.code || 'conflict',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function serviceUnavailable(
  message = 'service_unavailable',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 503,
    code: options.code || 'service_unavailable',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function internalError(
  message = 'internal_error',
  options: Omit<Partial<AppErrorOptions>, 'status' | 'message'> = {},
) {
  return appError({
    status: 500,
    code: options.code || 'internal_error',
    message,
    body: options.body,
    headers: options.headers,
    cause: options.cause,
  })
}

function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

function fromUnknownError(
  error: unknown,
  {
    defaultStatus = 500,
    defaultCode = 'internal_error',
    defaultMessage = 'internal_error',
  }: {
    defaultStatus?: number
    defaultCode?: string
    defaultMessage?: string
  } = {},
): AppError {
  if (isAppError(error)) return error
  if (error && typeof error === 'object') {
    const candidate = error as {
      status?: number
      statusCode?: number
      code?: string
      message?: string
      body?: unknown
      headers?: HeadersInit
      cause?: unknown
    }
    if (
      typeof candidate.status === 'number' ||
      typeof candidate.statusCode === 'number'
    ) {
      return appError({
        status:
          typeof candidate.status === 'number'
            ? candidate.status
            : (candidate.statusCode as number),
        code: candidate.code || defaultCode,
        message: candidate.message || defaultMessage,
        body: candidate.body,
        headers: candidate.headers,
        cause: candidate.cause,
      })
    }
  }
  if (error instanceof Error) {
    return appError({
      status: defaultStatus,
      code: defaultCode,
      message: error.message || defaultMessage,
      cause: error,
    })
  }
  return appError({
    status: defaultStatus,
    code: defaultCode,
    message: defaultMessage,
    cause: error,
  })
}

function appErrorBody(error: AppError) {
  if (error.body && typeof error.body === 'object') return error.body
  return {
    error: error.code,
    message: error.message,
  } satisfies AnyRecord
}

export {
  AppError,
  appError,
  appErrorBody,
  badRequest,
  conflict,
  forbidden,
  fromUnknownError,
  internalError,
  isAppError,
  notFound,
  serviceUnavailable,
  unauthorized,
}
