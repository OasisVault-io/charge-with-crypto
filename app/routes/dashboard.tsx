import { useLoaderData } from 'react-router';

import { DashboardPage } from '../components/dashboard/DashboardPage';
import {
  type DashboardConfig,
  type DashboardData
} from '../components/dashboard/dashboard.types';
import { getPublicConfig } from '../lib/services/configService';
import { getDashboardData } from '../lib/services/dashboardService';

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const merchantId = String(url.searchParams.get('merchantId') || 'merchant_demo');
  return {
    merchantId,
    appConfig: getPublicConfig(),
    dashboardData: getDashboardData(request, merchantId)
  };
}

export default function DashboardRoute() {
  const data = useLoaderData() as { merchantId: string; appConfig: DashboardConfig; dashboardData: DashboardData };
  return <DashboardPage appConfig={data.appConfig} initialData={data.dashboardData} merchantId={data.merchantId} />;
}
