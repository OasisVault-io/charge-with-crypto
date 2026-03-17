import { getAppContext } from '../../lib/runtime'
import { apiError, apiErrorResponse, json } from '../../lib/utils/api'

export async function loader({
  params,
}: {
  params: { chain?: string; asset?: string }
}) {
  if (!params.chain || !params.asset)
    return apiError('route params missing', 400)
  try {
    return json(
      await getAppContext().configService.getAssetPrice(
        params.chain,
        params.asset,
      ),
    )
  } catch (error) {
    return apiErrorResponse(error, {
      defaultCode: 'invalid_request',
      defaultStatus: 400,
    })
  }
}
