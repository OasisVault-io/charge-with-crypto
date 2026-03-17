import { type AnyRecord, type CheckoutLike } from '../shared/types'

class X402CatalogResolver<Sale> {
  resolve: (body: AnyRecord) => Promise<Sale>
  fromCheckout: (checkout: CheckoutLike) => Promise<Sale>
  validateProduct: (sale: Sale) => Sale
  discoveryExtension: (sale: Sale) => unknown

  constructor({
    resolve,
    fromCheckout,
    validateProduct,
    discoveryExtension,
  }: {
    resolve: (body: AnyRecord) => Promise<Sale>
    fromCheckout: (checkout: CheckoutLike) => Promise<Sale>
    validateProduct: (sale: Sale) => Sale
    discoveryExtension: (sale: Sale) => unknown
  }) {
    this.resolve = resolve
    this.fromCheckout = fromCheckout
    this.validateProduct = validateProduct
    this.discoveryExtension = discoveryExtension
  }

  resolveSale(body: AnyRecord) {
    return this.resolve(body)
  }

  saleFromCheckout(checkout: CheckoutLike) {
    return this.fromCheckout(checkout)
  }

  validateProductSale(sale: Sale) {
    return this.validateProduct(sale)
  }

  discoveryExtensionForProductSale(sale: Sale) {
    return this.discoveryExtension(sale)
  }
}

export { X402CatalogResolver }
