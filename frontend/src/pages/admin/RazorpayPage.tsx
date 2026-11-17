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
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedFrom, setAppliedFrom] = useState<number>();
  const [appliedTo, setAppliedTo] = useState<number>();
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [settlementSearch, setSettlementSearch] = useState("");
  const [settlementStatus, setSettlementStatus] = useState("all");
  const { data, error, isLoading, isFetching, refetch } = useQuery(
    razorpayDashboardQuery(paymentsSkip, settlementsSkip, appliedFrom, appliedTo),
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

  const paymentNeedle = paymentSearch.trim().toLowerCase();
  const filteredPayments = data.payments.items.filter((payment) => {
    const isRefunded = payment.amountRefunded > 0 || payment.refundStatus !== null;
    if (paymentStatus === "refunded" && !isRefunded) return false;
    if (paymentStatus !== "all" && paymentStatus !== "refunded" && payment.status !== paymentStatus) return false;
    if (paymentMethod !== "all" && payment.method !== paymentMethod) return false;
    if (!paymentNeedle) return true;
    return [payment.id, payment.orderId, payment.storeOrderNumber, payment.bankReference]
      .some((value) => value?.toLowerCase().includes(paymentNeedle));
  });
  const settlementNeedle = settlementSearch.trim().toLowerCase();
  const filteredSettlements = data.settlements.items.filter((settlement) => {
    if (settlementStatus !== "all" && settlement.status !== settlementStatus) return false;
    if (!settlementNeedle) return true;
    return [settlement.id, settlement.utr].some((value) => value?.toLowerCase().includes(settlementNeedle));
  });
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const captured = filteredPayments.filter((payment) => payment.status === "captured");
  const authorized = filteredPayments.filter((payment) => payment.status === "authorized");
  const processed = filteredSettlements.filter((settlement) => settlement.status === "processed");
  const created = filteredSettlements.filter((settlement) => settlement.status === "created");
  const failed = filteredSettlements.filter((settlement) => settlement.status === "failed");
  const summary = {
    capturedAmount: sum(captured.map((payment) => payment.amount)),
    capturedCount: captured.length,
    authorizedAmount: sum(authorized.map((payment) => payment.amount)),
    authorizedCount: authorized.length,
    refundedAmount: sum(filteredPayments.map((payment) => payment.amountRefunded)),
    processedSettlementAmount: sum(processed.map((settlement) => settlement.amount)),
    processedSettlementCount: processed.length,
    pendingSettlementAmount: sum(created.map((settlement) => settlement.amount)),
    pendingSettlementCount: created.length,
    settlementFees: sum(processed.map((settlement) => settlement.fees)),
    settlementTax: sum(processed.map((settlement) => settlement.tax)),
    failedSettlementCount: failed.length,
  };
  const s = summary;
  const localTimestamp = (date: string, endOfDay = false) => {
    if (!date) return undefined;
    return Math.floor(new Date(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}`).getTime() / 1000);
  };
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

      <section className="grid gap-3 rounded-2xl border bg-card/60 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">From date</span>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">To date</span>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3" />
        </label>
        <Button
          variant="outline"
          disabled={!!fromDate && !!toDate && fromDate > toDate}
          onClick={() => {
            setPaymentsSkip(0);
            setSettlementsSkip(0);
            setAppliedFrom(localTimestamp(fromDate));
            setAppliedTo(localTimestamp(toDate, true));
          }}
        >Apply date range</Button>
        <Button variant="ghost" onClick={() => {
          setFromDate("");
          setToDate("");
          setAppliedFrom(undefined);
          setAppliedTo(undefined);
          setPaymentsSkip(0);
          setSettlementsSkip(0);
        }}>Clear dates</Button>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Captured payments" value={money(s.capturedAmount)} detail={`${s.capturedCount} matching this page`} />
        <Metric label="Authorized, not captured" value={money(s.authorizedAmount)} detail={`${s.authorizedCount} matching; not counted as paid`} />
        <Metric label="Refunded" value={money(s.refundedAmount)} detail="Matching payments on this page" />
        <Metric label="Settled to bank" value={money(s.processedSettlementAmount)} detail={`${s.processedSettlementCount} matching processed settlements`} />
        <Metric label="Settlement created" value={money(s.pendingSettlementAmount)} detail={`${s.pendingSettlementCount} matching, awaiting processing`} />
        <Metric label="Settlement fees + tax" value={money(s.settlementFees + s.settlementTax)} detail={`${s.failedSettlementCount} matching failed settlements`} />
      </div>

      <section className="space-y-3 rounded-2xl border bg-card/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl">Payments</h3>
            <p className="text-xs text-muted-foreground">Filter the loaded page by status, method, ID, order or bank reference.</p>
          </div>
          <a href="https://dashboard.razorpay.com/app/payments" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            Open Razorpay payments <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_180px_180px]">
          <input
            value={paymentSearch}
            onChange={(event) => { setPaymentSearch(event.target.value); setPaymentsSkip(0); }}
            placeholder="Search payment, order or reference"
            className="h-10 rounded-md border bg-background px-3 text-sm"
          />
          <select value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); setPaymentsSkip(0); }} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="all">All payment statuses</option><option value="captured">Captured</option><option value="authorized">Authorized</option><option value="failed">Failed</option><option value="refunded">Refunded</option>
          </select>
          <select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPaymentsSkip(0); }} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="all">All methods</option><option value="card">Card</option><option value="upi">UPI</option><option value="netbanking">Netbanking</option><option value="wallet">Wallet</option><option value="emi">EMI</option>
          </select>
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
              {filteredPayments.map((payment) => (
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
              {!filteredPayments.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No payments match these filters on this page.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager skip={paymentsSkip} pageSize={data.pageSize} count={data.payments.items.length} filteredCount={filteredPayments.length} hasMore={data.payments.hasMore} onChange={setPaymentsSkip} />
      </section>

      <section className="space-y-3 rounded-2xl border bg-card/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl">Settlements</h3>
            <p className="text-xs text-muted-foreground">Filter payout batches by status, settlement ID or bank UTR.</p>
          </div>
          <a href="https://dashboard.razorpay.com/app/settlements" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            Open Razorpay settlements <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_220px]">
          <input
            value={settlementSearch}
            onChange={(event) => { setSettlementSearch(event.target.value); setSettlementsSkip(0); }}
            placeholder="Search settlement ID or UTR"
            className="h-10 rounded-md border bg-background px-3 text-sm"
          />
          <select value={settlementStatus} onChange={(event) => { setSettlementStatus(event.target.value); setSettlementsSkip(0); }} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="all">All settlement statuses</option><option value="created">Created / pending</option><option value="processed">Processed</option><option value="failed">Failed</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr><th className="p-2">Created</th><th className="p-2">Settlement ID</th><th className="p-2">Status</th><th className="p-2">Net payout</th><th className="p-2">Fees</th><th className="p-2">Tax</th><th className="p-2">Bank UTR</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSettlements.map((settlement) => (
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
              {!filteredSettlements.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No settlements match these filters on this page.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager skip={settlementsSkip} pageSize={data.pageSize} count={data.settlements.items.length} filteredCount={filteredSettlements.length} hasMore={data.settlements.hasMore} onChange={setSettlementsSkip} />
      </section>
    </div>
  );
}

function Pager({ skip, pageSize, count, filteredCount, hasMore, onChange }: { skip: number; pageSize: number; count: number; filteredCount: number; hasMore: boolean; onChange: (skip: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="mr-auto text-xs text-muted-foreground">API records {count ? skip + 1 : 0}–{skip + count} · {filteredCount} shown</span>
      <Button size="sm" variant="outline" disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - pageSize))}>Previous</Button>
      <Button size="sm" variant="outline" disabled={!hasMore} onClick={() => onChange(skip + pageSize)}>Next</Button>
    </div>
  );
}
