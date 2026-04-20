import { getAppContext } from '../../lib/runtime'
import {
  apiError,
  apiErrorResponse,
  json,
  requireInternalJobToken,
} from '../../lib/utils/api'
import { nowIso } from '../../lib/utils/time'

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') return apiError('method_not_allowed', 405)

  const context = getAppContext()
  const authError = requireInternalJobToken(
    request,
    context.config.internalJobToken,
  )
  if (authError) return authError

  try {
    const manual = await context.manualPaymentService.runScannerPass?.().catch(
      (error) => ({
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    const wallet =
      await context.paymentService.reconcilePendingWalletPaymentsBatch()
    return json({
      ok: true,
      at: nowIso(),
      manual: manual ?? { processed: 0, configured: false },
      wallet,
    })
  } catch (error) {
    return apiErrorResponse(error, {
      defaultCode: 'internal_job_error',
      defaultStatus: 500,
    })
  }
}
