import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useQuery } from "@/hooks/use-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { razorpayDashboardQuery } from "@/services/razorpay-dashboard.service";

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);

const when = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const statusStyle = (status: string) => {
  if (status === "captured" || status === "processed") return "bg-emerald-100 text-emerald-800";
  if (status === "authorized" || status === "created") return "bg-amber-100 text-amber-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-muted text-muted-foreground";
};

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border bg-card/70 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function RazorpayDashboard() {
  const [paymentsSkip, setPaymentsSkip] = useState(0);
  const [settlementsSkip, setSettlementsSkip] = useState(0);
  const { data, error, isLoading, isFetching, refetch } = useQuery(
    razorpayDashboardQuery(paymentsSkip, settlementsSkip),
  );

  if (isLoading) return <p className="text-muted-foreground">Loading Razorpay account…</p>;
  if (error || !data)
    return (
      <div className="space-y-3 rounded-2xl border bg-card/60 p-5">
        <p className="text-destructive">{error instanceof Error ? error.message : "Razorpay details could not be loaded."}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );

  const s = data.summary;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-3xl">Razorpay</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live account data · totals below are for the currently loaded 100-record pages.
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
            data.mode === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
          )}
        >
          {data.mode} mode
        </span>
        <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Captured payments" value={money(s.capturedAmount)} detail={`${s.capturedCount} on this page`} />
        <Metric label="Authorized, not captured" value={money(s.authorizedAmount)} detail={`${s.authorizedCount} payments; these are not counted as paid`} />
        <Metric label="Refunded" value={money(s.refundedAmount)} detail="Refunded amount on this page" />
        <Metric label="Settled to bank" value={money(s.processedSettlementAmount)} detail={`${s.processedSettlementCount} processed settlements on this page`} />
        <Metric label="Settlement created" value={money(s.pendingSettlementAmount)} detail={`${s.pendingSettlementCount} created, awaiting processing`} />
        <Metric label="Settlement fees + tax" value={money(s.settlementFees + s.settlementTax)} detail={`${s.failedSettlementCount} failed settlements on this page`} />
      </div>

      <section className="space-y-3 rounded-2xl border bg-card/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl">Payments</h3>
            <p className="text-xs text-muted-foreground">Latest Razorpay payment attempts, including failed, authorized, captured and refunded.</p>
          </div>
          <a href="https://dashboard.razorpay.com/app/payments" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            Open Razorpay payments <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2">Date</th><th className="p-2">Payment ID</th><th className="p-2">Store order</th>
                <th className="p-2">Status / method</th><th className="p-2">Amount</th><th className="p-2">Fee + tax</th><th className="p-2">Refunded</th><th className="p-2">Bank / UPI ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.payments.items.map((payment) => (
                <tr key={payment.id}>
                  <td className="whitespace-nowrap p-2">{when(payment.createdAt)}</td>
                  <td className="p-2"><a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://dashboard.razorpay.com/app/payments/${encodeURIComponent(payment.id)}`}>{payment.id}</a></td>
                  <td className="p-2">{payment.storeOrderNumber ?? payment.orderId ?? "—"}</td>
                  <td className="p-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", statusStyle(payment.status))}>{payment.status}</span>
                    <span className="mt-1 block capitalize text-muted-foreground">{payment.method ?? "—"}</span>
                  </td>
                  <td className="whitespace-nowrap p-2">{money(payment.amount)}</td>
                  <td className="whitespace-nowrap p-2">{money(payment.fee + payment.tax)}</td>
                  <td className="whitespace-nowrap p-2">{money(payment.amountRefunded)}</td>
                  <td className="p-2">{payment.bankReference ?? "—"}</td>
                </tr>
              ))}
              {!data.payments.items.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No payments returned by Razorpay.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager skip={paymentsSkip} pageSize={data.pageSize} hasMore={data.payments.hasMore} onChange={setPaymentsSkip} />
      </section>

      <section className="space-y-3 rounded-2xl border bg-card/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl">Settlements</h3>
            <p className="text-xs text-muted-foreground">Payout batches, net amounts, processing fees, tax and bank UTR.</p>
          </div>
          <a href="https://dashboard.razorpay.com/app/settlements" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            Open Razorpay settlements <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr><th className="p-2">Created</th><th className="p-2">Settlement ID</th><th className="p-2">Status</th><th className="p-2">Net payout</th><th className="p-2">Fees</th><th className="p-2">Tax</th><th className="p-2">Bank UTR</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.settlements.items.map((settlement) => (
                <tr key={settlement.id}>
                  <td className="whitespace-nowrap p-2">{when(settlement.createdAt)}</td>
                  <td className="p-2"><a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://dashboard.razorpay.com/app/settlements/${encodeURIComponent(settlement.id)}`}>{settlement.id}</a></td>
                  <td className="p-2"><span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", statusStyle(settlement.status))}>{settlement.status}</span></td>
                  <td className="whitespace-nowrap p-2">{money(settlement.amount)}</td>
                  <td className="whitespace-nowrap p-2">{money(settlement.fees)}</td>
                  <td className="whitespace-nowrap p-2">{money(settlement.tax)}</td>
                  <td className="p-2">{settlement.utr ?? "—"}</td>
                </tr>
              ))}
              {!data.settlements.items.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No settlements returned by Razorpay.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager skip={settlementsSkip} pageSize={data.pageSize} hasMore={data.settlements.hasMore} onChange={setSettlementsSkip} />
      </section>
    </div>
  );
}

function Pager({ skip, pageSize, hasMore, onChange }: { skip: number; pageSize: number; hasMore: boolean; onChange: (skip: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="mr-auto text-xs text-muted-foreground">Showing {skip + 1}–{skip + pageSize}</span>
      <Button size="sm" variant="outline" disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - pageSize))}>Previous</Button>
      <Button size="sm" variant="outline" disabled={!hasMore} onClick={() => onChange(skip + pageSize)}>Next</Button>
    </div>
  );
}
