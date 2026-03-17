import { useLoaderData } from 'react-router'

import { CheckoutPage } from '../components/checkout/CheckoutPage'
import { getCheckoutBootstrap } from '../lib/services/checkoutService'

export async function loader({
  params,
  request,
}: {
  params: { id?: string }
  request: Request
}) {
  const checkoutId = params.id || ''
  const url = new URL(request.url)
  return {
    checkoutId,
    initialData: await getCheckoutBootstrap(checkoutId),
    templateParam: String(url.searchParams.get('template') || ''),
  }
}

export default function CheckoutRoute() {
  const data = useLoaderData() as {
    checkoutId: string
    initialData: any
    templateParam: string
  }
  return (
    <CheckoutPage
      checkoutId={data.checkoutId}
      initialData={data.initialData}
      templateParam={data.templateParam}
    />
  )
}
