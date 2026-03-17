import { useLoaderData } from 'react-router'

import { CheckoutPage } from '../components/checkout/CheckoutPage'
import { getAppContext } from '../lib/runtime'

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
    initialData:
      await getAppContext().checkoutService.getCheckoutBootstrap(checkoutId),
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
