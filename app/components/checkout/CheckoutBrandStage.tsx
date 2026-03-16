type CheckoutBrandStageProps = {
  description: string
  heroParts: {
    lead: string
    trail: string
  }
}

export function CheckoutBrandStage({
  description,
  heroParts,
}: CheckoutBrandStageProps) {
  return (
    <section className="checkout-brand-stage">
      <div className="brand-copy">
        <h1 className="brand-title">
          <span className="brand-line">CHECKOUT</span>
          <span className="brand-line brand-line-accent">
            <img
              alt="OasisVault Logo"
              className="brand-isotype"
              src="/oasisvault-isotype-green.png"
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
