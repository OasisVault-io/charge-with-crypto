class X402RequestAdapter {
  toNodeishRequest: (request: Request) => unknown
  resolveRequestHandler: (request: Request) => Promise<unknown>
  checkoutRequestHandler: (
    request: Request,
    checkoutId: string,
  ) => Promise<unknown>
  productAccessRequestHandler: (
    request: Request,
    productId: string,
  ) => Promise<unknown>
  handleResolve: (
    req: unknown,
    body?: Record<string, unknown>,
  ) => Promise<unknown>
  handleCheckout: (
    req: unknown,
    checkoutId: string,
    body?: Record<string, unknown>,
  ) => Promise<unknown>
  handleProductAccess: (
    req: unknown,
    productId: string,
    body?: Record<string, unknown>,
  ) => Promise<unknown>

  constructor(deps: {
    toNodeishRequest: (request: Request) => unknown
    resolveRequestHandler: (request: Request) => Promise<unknown>
    checkoutRequestHandler: (
      request: Request,
      checkoutId: string,
    ) => Promise<unknown>
    productAccessRequestHandler: (
      request: Request,
      productId: string,
    ) => Promise<unknown>
    handleResolve: (
      req: unknown,
      body?: Record<string, unknown>,
    ) => Promise<unknown>
    handleCheckout: (
      req: unknown,
      checkoutId: string,
      body?: Record<string, unknown>,
    ) => Promise<unknown>
    handleProductAccess: (
      req: unknown,
      productId: string,
      body?: Record<string, unknown>,
    ) => Promise<unknown>
  }) {
    this.toNodeishRequest = deps.toNodeishRequest
    this.resolveRequestHandler = deps.resolveRequestHandler
    this.checkoutRequestHandler = deps.checkoutRequestHandler
    this.productAccessRequestHandler = deps.productAccessRequestHandler
    this.handleResolve = deps.handleResolve
    this.handleCheckout = deps.handleCheckout
    this.handleProductAccess = deps.handleProductAccess
  }

  nodeishRequest(request: Request) {
    return this.toNodeishRequest(request)
  }

  resolveRequest(request: Request) {
    return this.resolveRequestHandler(request)
  }

  checkoutRequest(request: Request, checkoutId: string) {
    return this.checkoutRequestHandler(request, checkoutId)
  }

  productAccessRequest(request: Request, productId: string) {
    return this.productAccessRequestHandler(request, productId)
  }

  handleResolveRequest(req: unknown, body?: Record<string, unknown>) {
    return this.handleResolve(req, body)
  }

  handleCheckoutRequest(
    req: unknown,
    checkoutId: string,
    body?: Record<string, unknown>,
  ) {
    return this.handleCheckout(req, checkoutId, body)
  }

  handleProductAccessRequest(
    req: unknown,
    productId: string,
    body?: Record<string, unknown>,
  ) {
    return this.handleProductAccess(req, productId, body)
  }
}

export { X402RequestAdapter }
