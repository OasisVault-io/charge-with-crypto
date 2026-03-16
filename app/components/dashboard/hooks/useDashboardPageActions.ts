import { useEffectEvent } from 'react';

import { fetchJson, jsonRequest, withDashboardToken } from '../../../lib/browser/api';
import { dashboardTokenStorageKey } from '../dashboard.shared';
import {
  type DashboardCheckoutDraft,
  type DashboardConfig,
  type DashboardCreatedCheckout,
  type DashboardData,
  type DashboardMerchantDraft,
  type MerchantPayment
} from '../dashboard.types';

type UseDashboardPageActionsParams = {
  appConfig: DashboardConfig | null | undefined;
  checkoutDraft: DashboardCheckoutDraft;
  dashboardToken: string;
  filteredPayments: MerchantPayment[];
  merchantDraft: DashboardMerchantDraft;
  merchantId: string;
  clearDashboardToken: () => void;
  dashboardReloaded: (next: DashboardData, appConfig: DashboardConfig | null | undefined) => void;
  setAuthInput: (value: string) => void;
  setAuthStatus: (value: string) => void;
  setCreatedCheckout: (value: DashboardCreatedCheckout | null) => void;
  setDashboardToken: (value: string) => void;
  setMerchantField: <K extends keyof DashboardMerchantDraft>(field: K, value: DashboardMerchantDraft[K]) => void;
  setMerchantStatus: (value: string) => void;
};

const fileToDataUrl = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read logo file.'));
    reader.readAsDataURL(file);
  });
};

export const useDashboardPageActions = ({
  appConfig,
  checkoutDraft,
  dashboardToken,
  filteredPayments,
  merchantDraft,
  merchantId,
  clearDashboardToken,
  dashboardReloaded,
  setAuthInput,
  setAuthStatus,
  setCreatedCheckout,
  setDashboardToken,
  setMerchantField,
  setMerchantStatus
}: UseDashboardPageActionsParams) => {
  const reloadDashboard = useEffectEvent(async (tokenOverride = dashboardToken) => {
    const data = await fetchJson<DashboardData>(
      `/api/dashboard?merchantId=${encodeURIComponent(merchantId)}`,
      withDashboardToken(undefined, tokenOverride)
    );
    dashboardReloaded(data, appConfig);

    if (!data?.authenticated && tokenOverride) {
      clearDashboardToken();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(dashboardTokenStorageKey);
      }
    }

    return data;
  });

  const unlockDashboard = useEffectEvent(async (rawToken: string) => {
    const nextToken = rawToken.trim();
    setAuthStatus('Checking token...');
    setDashboardToken(nextToken);
    if (typeof window !== 'undefined') {
      if (nextToken) window.localStorage.setItem(dashboardTokenStorageKey, nextToken);
      else window.localStorage.removeItem(dashboardTokenStorageKey);
    }

    const data = await reloadDashboard(nextToken);
    if (!data?.authenticated) {
      setAuthStatus('Invalid dashboard token.');
      clearDashboardToken();
      setAuthInput('');
      return;
    }
    setAuthInput('');
    setAuthStatus('');
  });

  const saveMerchant = useEffectEvent(async () => {
    setMerchantStatus('Saving merchant settings...');
    const payload = {
      ...merchantDraft,
      plans: merchantDraft.plans.map((plan) => ({
        ...plan,
        amountUsd: Number(plan.amountUsd || 0)
      }))
    };

    await fetchJson(
      `/api/merchants/${encodeURIComponent(merchantId)}`,
      withDashboardToken(
        jsonRequest(payload, {
          method: 'PATCH'
        }),
        dashboardToken
      )
    );

    setMerchantStatus('Saved.');
    await reloadDashboard(dashboardToken);
  });

  const createCheckout = useEffectEvent(async (resolved: boolean) => {
    const payload = {
      merchantId,
      planId: checkoutDraft.planId || undefined,
      title: checkoutDraft.title || undefined,
      description: checkoutDraft.description || undefined,
      paymentRail: checkoutDraft.paymentRail,
      orderId: checkoutDraft.orderId || undefined,
      amountUsd: Number(checkoutDraft.amountUsd || 0),
      referenceId: checkoutDraft.referenceId || undefined,
      successUrl: checkoutDraft.successUrl || undefined,
      cancelUrl: checkoutDraft.cancelUrl || undefined,
      enabledChains: checkoutDraft.enabledChains,
      acceptedAssets: checkoutDraft.acceptedAssets
    };

    const created = await fetchJson<DashboardCreatedCheckout>(
      resolved ? '/api/checkouts/resolve' : '/api/checkouts',
      withDashboardToken(
        jsonRequest(payload, {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() }
        }),
        dashboardToken
      )
    );

    await reloadDashboard(dashboardToken);
    setCreatedCheckout(created);
  });

  const exportPayments = () => {
    if (!filteredPayments.length) return;
    const header = [
      'payment_id',
      'created_at',
      'status',
      'method',
      'order_id',
      'title',
      'amount_usd',
      'asset',
      'chain',
      'wallet_address',
      'tx_hash',
      'recipient_address'
    ];
    const csvRows = filteredPayments.map((payment) => [
      payment.id,
      payment.createdAt,
      payment.status,
      payment.method,
      payment.checkout?.orderId || '',
      payment.checkout?.title || '',
      String(payment.checkout?.amountUsd || 0),
      payment.asset || '',
      payment.chain || '',
      payment.walletAddress || '',
      payment.txHash || '',
      payment.recipientAddress || ''
    ]);

    const csv = [header]
      .concat(csvRows)
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `charge-with-crypto-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setMerchantField('logoUrl', dataUrl);
  };

  return {
    createCheckout,
    exportPayments,
    reloadDashboard,
    saveMerchant,
    unlockDashboard,
    uploadLogo
  };
};
