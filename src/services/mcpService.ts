// @ts-nocheck
const { createCheckoutResponse } = require('../routes/api');
const { buildProductCheckoutInput, productEndpoints, publicProduct, requireProduct, resolveProductMerchant } = require('./productService');

const MCP_SERVER_VERSION = '1.0.0';

class McpService {
  constructor({ store, config, priceService, manualPaymentService, bitcoinAddressService, x402Service }) {
    this.store = store;
    this.config = config;
    this.priceService = priceService;
    this.manualPaymentService = manualPaymentService;
    this.bitcoinAddressService = bitcoinAddressService;
    this.x402Service = x402Service;
  }

  info() {
    return {
      name: 'charge-with-crypto-mcp',
      version: MCP_SERVER_VERSION,
      transport: 'streamable-http',
      endpoint: `${this.config.baseUrl}/mcp`,
      capabilities: { tools: true },
      instructions: 'Use POST JSON-RPC requests for initialize, tools/list, and tools/call.'
    };
  }

  initializeResult(protocolVersion) {
    return {
      protocolVersion: protocolVersion || '2025-11-05',
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'charge-with-crypto-mcp',
        version: MCP_SERVER_VERSION
      },
      instructions: 'Discover products here, create hosted checkouts for humans, and get x402 access details for agents.'
    };
  }

  tools() {
    return [
      {
        name: 'list_products',
        title: 'List products',
        description: 'List active merchant products and the endpoints used for human checkout and x402 agent access.',
        inputSchema: {
          type: 'object',
          properties: {
            merchantId: { type: 'string' }
          },
          additionalProperties: false
        }
      },
      {
        name: 'get_product',
        title: 'Get product',
        description: 'Fetch one product, including its checkout endpoint, x402 endpoint, and merchant metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' }
          },
          required: ['productId'],
          additionalProperties: false
        }
      },
      {
        name: 'create_human_checkout',
        title: 'Create human checkout',
        description: 'Create a hosted checkout session for a product so a human can pay through the wallet UI.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            referenceId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            orderId: { type: 'string' },
            template: { type: 'string' }
          },
          required: ['productId'],
          additionalProperties: false
        }
      },
      {
        name: 'get_agent_access',
        title: 'Get agent access',
        description: 'Return the x402 endpoint and request body for an agent to purchase a product.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            referenceId: { type: 'string' },
            purchaseId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            orderId: { type: 'string' }
          },
          required: ['productId', 'referenceId', 'purchaseId'],
          additionalProperties: false
        }
      }
    ];
  }

  async callTool(name, args) {
    if (name === 'list_products') {
      const merchantId = String(args.merchantId || '').trim();
      const products = this.store.list('products')
        .filter((product) => product.active !== false)
        .filter((product) => (merchantId ? product.merchantId === merchantId : true))
        .map((product) => publicProduct(product, this.config));
      return this.toolResult(`Found ${products.length} product${products.length === 1 ? '' : 's'}.`, { products });
    }

    if (name === 'get_product') {
      const product = requireProduct(this.store, args.productId);
      const merchant = resolveProductMerchant({ store: this.store, product });
      return this.toolResult(`Loaded product ${product.title}.`, {
        product: publicProduct(product, this.config),
        merchant: {
          id: merchant.id,
          name: merchant.brandName || merchant.name,
          supportEmail: merchant.supportEmail || ''
        },
        x402: this.x402Service?.status?.() || { enabled: false },
        mcp: {
          endpoint: `${this.config.baseUrl}/mcp`
        }
      });
    }

    if (name === 'create_human_checkout') {
      const product = requireProduct(this.store, args.productId);
      const merchant = resolveProductMerchant({ store: this.store, product });
      const created = await createCheckoutResponse({
        store: this.store,
        config: this.config,
        priceService: this.priceService,
        manualPaymentService: this.manualPaymentService,
        bitcoinAddressService: this.bitcoinAddressService,
        body: buildProductCheckoutInput({ product, merchant, body: args })
      });
      return this.toolResult(`Created hosted checkout for ${product.title}.`, {
        product: publicProduct(product, this.config),
        checkout: created.body.checkout,
        checkoutUrl: created.body.checkoutUrl,
        statusUrl: `${this.config.baseUrl}/api/checkouts/${created.body.checkout.id}/status`
      });
    }

    if (name === 'get_agent_access') {
      const product = requireProduct(this.store, args.productId);
      const endpoints = productEndpoints({ product, config: this.config });
      return this.toolResult(`Prepared x402 access details for ${product.title}.`, {
        product: publicProduct(product, this.config),
        x402Enabled: Boolean(this.x402Service?.status?.().enabled),
        endpoint: endpoints.accessUrl,
        method: 'POST',
        body: {
          referenceId: String(args.referenceId || ''),
          purchaseId: String(args.purchaseId || args.idempotencyKey || ''),
          quantity: args.quantity == null ? 1 : Number(args.quantity),
          ...(args.orderId ? { orderId: String(args.orderId) } : {})
        }
      });
    }

    const err = new Error(`Unknown tool: ${name}`);
    err.statusCode = 404;
    throw err;
  }

  toolResult(summary, structuredContent) {
    return {
      content: [
        {
          type: 'text',
          text: summary
        }
      ],
      structuredContent
    };
  }
}

module.exports = { McpService };

export { McpService };
