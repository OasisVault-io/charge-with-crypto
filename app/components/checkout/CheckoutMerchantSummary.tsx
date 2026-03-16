import { type CheckoutRecord } from './checkout.types'
import { LogoImage } from './LogoImage'

type CheckoutMerchantSummaryProps = {
  checkout: CheckoutRecord | null | undefined
  logoSrc: string
  merchantName: string
  setLogoSrc: (value: string) => void
}

export function CheckoutMerchantSummary({
  checkout,
  logoSrc,
  merchantName,
  setLogoSrc,
}: CheckoutMerchantSummaryProps) {
  return (
    <section className="card checkout-info-card">
      <div className="summary-panel muted">
        <div className="summary-brand">
          <LogoImage
            alt={`${merchantName} logo`}
            className="summary-logo"
            src={logoSrc}
            setLogoSrc={setLogoSrc}
          />
          <div className="summary-brand-copy">
            <div className="eyebrow">Merchant</div>
            <div className="summary-brand-row">
              <strong className="summary-brand-name">{merchantName}</strong>
              <div className="muted small-copy summary-brand-description">
                {checkout?.description || 'Wallet-first crypto checkout'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
