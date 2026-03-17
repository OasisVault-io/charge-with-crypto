import { useCheckoutPageContext } from './context/CheckoutPageContext'

export function CheckoutBrandStage() {
  const { checkout, description, heroParts, logoSrc, merchantName } =
    useCheckoutPageContext()
  const brandLogoSrc = checkout?.merchantLogoUrl
    ? logoSrc
    : '/oasisvault-isotype-green.png'
  const brandLogoAlt =
    merchantName && merchantName !== 'merchant'
      ? `${merchantName} logo`
      : 'OasisVault Logo'

  return (
    <section className="checkout-brand-stage">
      <div className="brand-copy">
        <h1 className="brand-title">
          <span className="brand-line">CHECKOUT</span>
          <span className="brand-line brand-line-accent">
            <img
              alt={brandLogoAlt}
              className="brand-isotype"
              src={brandLogoSrc}
            />
            <span>{heroParts.lead}</span>
          </span>
          <span className="brand-line" hidden={!heroParts.trail}>
            {heroParts.trail}
          </span>
        </h1>
        <p className="brand-description">{description}</p>
      </div>
    </section>
  )
}
