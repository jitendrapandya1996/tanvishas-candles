import { apiGet } from "@/services/api-client";

export type RazorpayDashboardData = {
  mode: "live" | "test";
  pageSize: number;
  payments: {
    skip: number;
    hasMore: boolean;
    items: {
      id: string;
      orderId: string | null;
      storeOrderNumber: string | null;
      amount: number;
      currency: string;
      status: string;
      method: string | null;
      captured: boolean;
      amountRefunded: number;
      refundStatus: string | null;
      fee: number;
      tax: number;
      bankReference: string | null;
      createdAt: number;
    }[];
  };
  settlements: {
    skip: number;
    hasMore: boolean;
    items: {
      id: string;
      amount: number;
      status: string;
      fees: number;
      tax: number;
      utr: string | null;
      createdAt: number;
    }[];
  };
  summary: {
    capturedCount: number;
    capturedAmount: number;
    authorizedCount: number;
    authorizedAmount: number;
    refundedAmount: number;
    processedSettlementCount: number;
    processedSettlementAmount: number;
    pendingSettlementCount: number;
    pendingSettlementAmount: number;
    settlementFees: number;
    settlementTax: number;
    failedSettlementCount: number;
  };
};

export function razorpayDashboardQuery(paymentsSkip: number, settlementsSkip: number) {
  const params = new URLSearchParams({
    paymentsSkip: String(paymentsSkip),
    settlementsSkip: String(settlementsSkip),
  });
  return {
    queryKey: ["admin", "razorpay", paymentsSkip, settlementsSkip] as const,
    queryFn: () => apiGet<RazorpayDashboardData>(`/payments/admin/dashboard?${params}`),
    staleTime: 30_000,
  };
}
