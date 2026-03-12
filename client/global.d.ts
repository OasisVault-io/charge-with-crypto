// @ts-nocheck
declare global {
  interface Window {
    ethereum?: {
      request?: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
    };
    ChargeWithCryptoVendors?: {
      xverse?: {
        isAvailable?: () => boolean;
        connect?: () => Promise<{ address?: string } | null>;
        sendPayment?: (args: { address: string; amountSats: bigint }) => Promise<{ txid?: string } | null>;
      };
    };
  }
}

export {};
