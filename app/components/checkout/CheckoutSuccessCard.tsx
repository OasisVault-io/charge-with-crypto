import { chainLabel, explorerTx, formatUsdAmount } from './checkout.shared'
import { useCheckoutPageContext } from './context/CheckoutPageContext'

export function CheckoutSuccessCard() {
  const { checkout, config, payments } = useCheckoutPageContext()

  const confirmedPayment =
    payments.find((payment) => payment.status === 'confirmed') || null
  const confirmedChain =
    confirmedPayment?.chain ||
    checkout?.paidChain ||
    checkout?.defaultChain ||
    ''
  const confirmedAsset =
    confirmedPayment?.asset ||
    checkout?.paidAsset ||
    checkout?.defaultAsset ||
    checkout?.asset ||
    ''

  return (
    <section className="success-card">
      <div className="success-mark">Paid</div>
      <div className="success-head">
        <h2>Payment confirmed</h2>
        <p className="muted">{`${checkout?.title || 'Payment'} was confirmed on ${chainLabel(config, confirmedChain)}.`}</p>
      </div>
      <div className="success-meta">
        <div className="success-meta-row">
          <span>Amount</span>
          <strong>{formatUsdAmount(checkout?.amountUsd || 0)}</strong>
        </div>
        <div className="success-meta-row">
          <span>Asset</span>
          <strong>{confirmedAsset}</strong>
        </div>
        <div className="success-meta-row">
          <span>Network</span>
          <strong>{chainLabel(config, confirmedChain)}</strong>
        </div>
        {confirmedPayment?.txHash ? (
          <div className="success-meta-row">
            <span>Transaction</span>
            <strong>
              <a
                href={explorerTx(confirmedChain, confirmedPayment.txHash)}
                rel="noreferrer"
                target="_blank"
              >
                {confirmedPayment.txHash.slice(0, 10)}...
              </a>
            </strong>
          </div>
        ) : null}
      </div>
      <div className="row">
        {checkout?.successUrl ? (
          <a className="link-button" href={checkout.successUrl}>
            Return to merchant
          </a>
        ) : null}
      </div>
    </section>
  )
}
