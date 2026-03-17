import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function loader({ params }: { params: { id?: string } }) {
  try {
    return json(
      await getAppContext().productService.getProductDetail(params.id || ''),
    )
  } catch (error) {
    return apiErrorResponse(error, {
      defaultCode: 'not_found',
      defaultStatus: 404,
    })
  }
}

export async function action({
  request,
  params,
}: {
  request: Request
  params: { id?: string }
}) {
  if (request.method !== 'PATCH') return apiError('method_not_allowed', 405)
  try {
    return json(
      await getAppContext().productService.updateProduct(
        request,
        params.id || '',
      ),
    )
  } catch (error) {
    return apiErrorResponse(error, {
      defaultCode: 'invalid_request',
      defaultStatus: 400,
    })
  }
}
