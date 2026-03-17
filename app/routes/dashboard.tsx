import { useLoaderData } from 'react-router';

import {
  type DashboardConfig,
  type DashboardData
} from '../components/dashboard/dashboard.types';
import { DashboardPage } from '../components/dashboard/DashboardPage';
import { getAppContext } from '../lib/runtime';

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const merchantId = String(url.searchParams.get('merchantId') || 'merchant_demo');
  const context = getAppContext();
  return {
    merchantId,
    appConfig: context.configService.getPublicConfig(),
    dashboardData: context.dashboardService.getDashboardData(request, merchantId)
  };
}

export default function DashboardRoute() {
  const data = useLoaderData() as { merchantId: string; appConfig: DashboardConfig; dashboardData: DashboardData };
  return <DashboardPage appConfig={data.appConfig} initialData={data.dashboardData} merchantId={data.merchantId} />;
}
