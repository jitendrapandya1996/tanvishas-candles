import { env } from "../../config/env.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { getOrderForPayment, getOrderForRazorpayOrder, markOrderPaid, setRazorpayOrderId } from "./payments.repository.js";
import { verifyRazorpaySignature, verifyRazorpayWebhookSignature } from "./razorpay-signature.js";

type Contact = { first_name?: string; last_name?: string; email?: string; phone?: string };

const RAZORPAY_PAGE_SIZE = 100;

function paymentCredentials() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Online payments are not configured. Choose Cash on Delivery.");
  }
  return { id: env.RAZORPAY_KEY_ID, secret: env.RAZORPAY_KEY_SECRET };
}

async function getPayableOrder(orderId: string, userId: string) {
  const { data: order, error } = await getOrderForPayment(orderId);
  if (error) throw new Error("Could not load the order");
  if (!order || order.user_id !== userId) throw new Error("Order not found");
  if (order.status === "cancelled") throw new Error("This order was cancelled");
  if (order.payment_status === "paid") throw new Error("This order is already paid");
  return order;
}

export async function createPaymentOrder(orderId: string, userId: string) {
  const { id, secret } = paymentCredentials();
  const order = await getPayableOrder(orderId, userId);
  if (order.razorpay_order_id) {
    const contact = (order.contact ?? {}) as Contact;
    return {
      keyId: id,
      razorpayOrderId: order.razorpay_order_id,
      amount: Math.round(Number(order.total) * 100),
      orderNumber: order.order_number,
      prefill: {
        name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
        email: contact.email ?? "",
        contact: contact.phone ?? "",
      },
    };
  }
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: Math.round(Number(order.total) * 100),
      currency: "INR",
      receipt: order.order_number,
      notes: { order_id: order.id },
    }),
  });
  if (!response.ok) {
    console.error("Razorpay order API failed", response.status, await response.text());
    throw new Error("Could not start the payment. Please try again.");
  }

  const razorpayOrder = (await response.json()) as { id: string; amount: number };
  const { data: attached, error } = await setRazorpayOrderId(order.id, razorpayOrder.id);
  if (error || !attached) throw new Error("The order changed before payment could start. Please try again.");

  const contact = (order.contact ?? {}) as Contact;
  return {
    keyId: id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    orderNumber: order.order_number,
    prefill: {
      name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
      email: contact.email ?? "",
      contact: contact.phone ?? "",
    },
  };
}

export async function verifyPayment(input: {
  orderId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}, userId: string) {
  const { id, secret } = paymentCredentials();
  const { data: order, error } = await getOrderForPayment(input.orderId);
  if (error) throw new Error("Could not verify the order");
  if (!order || order.user_id !== userId) throw new Error("Order not found");
  if (order.payment_status === "paid") return { ok: true };
  if (order.razorpay_order_id !== input.razorpay_order_id) throw new Error("Payment does not match this order");

  if (!verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, secret)) {
    throw new Error("Payment could not be verified");
  }

  const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.razorpay_payment_id)}`, {
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
  });
  if (!paymentResponse.ok) {
    console.error("Razorpay payment lookup failed", paymentResponse.status);
    return { ok: true, pending: true };
  }
  const payment = (await paymentResponse.json()) as RazorpayPayment;
  const amountPaise = Math.round(Number(order.total) * 100);
  if (payment.id !== input.razorpay_payment_id || payment.order_id !== input.razorpay_order_id
    || payment.amount !== amountPaise || payment.currency !== "INR") {
    throw new Error("Payment details do not match this order");
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    return { ok: true, pending: true };
  }

  const { data: marked, error: updateError } = await markOrderPaid(
    order.id,
    input.razorpay_order_id,
    input.razorpay_payment_id,
    new Date((payment.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    payment.method ?? null,
    razorpayReferenceId(payment.acquirer_data),
  );
  if (updateError || !marked)
    throw new Error("Payment was verified but the order changed before it could be recorded.");
  return { ok: true };
}

type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  method?: string;
  created_at?: number;
  acquirer_data?: Record<string, string | undefined>;
};

function razorpayReferenceId(data?: RazorpayPayment["acquirer_data"]) {
  return data?.rrn ?? data?.upi_transaction_id ?? data?.bank_transaction_id ?? null;
}

export async function handleRazorpayWebhook(rawBody: Buffer, signature: string | undefined) {
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("Razorpay webhook is not configured");
  if (!signature || !verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) {
    throw new Error("Invalid Razorpay webhook signature");
  }

  let event: { event?: string; payload?: { payment?: { entity?: RazorpayPayment } } };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
  } catch {
    throw new Error("Invalid Razorpay webhook payload");
  }
  if (event.event !== "payment.captured") return { ok: true, ignored: true };

  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id || payment.status !== "captured" || payment.captured !== true) {
    throw new Error("Invalid captured payment payload");
  }
  const { data: order, error } = await getOrderForRazorpayOrder(payment.order_id);
  if (error) throw new Error("Could not load the matching order");
  if (!order) throw new Error("No order matches the Razorpay order ID");
  if (payment.amount !== Math.round(Number(order.total) * 100) || payment.currency !== "INR") {
    throw new Error("Captured payment amount does not match the order");
  }
  if (order.payment_status === "paid" && order.razorpay_payment_id === payment.id) return { ok: true };

  const { data: marked, error: updateError } = await markOrderPaid(
    order.id,
    payment.order_id,
    payment.id,
    new Date((payment.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    payment.method ?? null,
    razorpayReferenceId(payment.acquirer_data),
  );
  if (updateError || !marked) throw new Error("Could not record the captured payment");
  return { ok: true };
}

type RazorpayCollection<T> = { items?: T[]; count?: number };
type RazorpayDashboardPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  captured: boolean;
  amount_refunded: number;
  refund_status: string | null;
  fee: number | null;
  tax: number | null;
  acquirer_data?: Record<string, string | undefined>;
  created_at: number;
};
type RazorpayDashboardSettlement = {
  id: string;
  amount: number;
  status: string;
  fees: number;
  tax: number;
  utr: string | null;
  created_at: number;
};

async function getRazorpayCollection<T>(resource: string, skip: number) {
  const { id, secret } = paymentCredentials();
  const url = new URL(`https://api.razorpay.com/v1/${resource}`);
  url.searchParams.set("count", String(RAZORPAY_PAGE_SIZE));
  url.searchParams.set("skip", String(skip));
  const response = await fetch(url, {
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
  });
  if (!response.ok) {
    console.error(`Razorpay ${resource} request failed`, response.status);
    throw new Error("Razorpay dashboard data could not be loaded. Check the backend API keys and account access.");
  }
  return (await response.json()) as RazorpayCollection<T>;
}

export async function getRazorpayDashboard(paymentsSkip: number, settlementsSkip: number) {
  const [paymentCollection, settlementCollection] = await Promise.all([
    getRazorpayCollection<RazorpayDashboardPayment>("payments", paymentsSkip),
    getRazorpayCollection<RazorpayDashboardSettlement>("settlements", settlementsSkip),
  ]);
  const payments = paymentCollection.items ?? [];
  const settlements = settlementCollection.items ?? [];
  const razorpayOrderIds = [...new Set(payments.map((payment) => payment.order_id).filter((id): id is string => !!id))];

  let orderNumbers = new Map<string, string>();
  if (razorpayOrderIds.length) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("order_number,razorpay_order_id")
      .in("razorpay_order_id", razorpayOrderIds);
    if (error) throw new Error("Razorpay data loaded, but local order references could not be matched.");
    orderNumbers = new Map((data ?? []).map((order) => [order.razorpay_order_id!, order.order_number]));
  }

  const safePayments = payments.map((payment) => ({
    id: payment.id,
    orderId: payment.order_id,
    storeOrderNumber: payment.order_id ? orderNumbers.get(payment.order_id) ?? null : null,
    amount: payment.amount ?? 0,
    currency: payment.currency ?? "INR",
    status: payment.status ?? "unknown",
    method: payment.method ?? null,
    captured: payment.captured === true,
    amountRefunded: payment.amount_refunded ?? 0,
    refundStatus: payment.refund_status ?? null,
    fee: payment.fee ?? 0,
    tax: payment.tax ?? 0,
    bankReference: razorpayReferenceId(payment.acquirer_data),
    createdAt: payment.created_at,
  }));
  const safeSettlements = settlements.map((settlement) => ({
    id: settlement.id,
    amount: settlement.amount ?? 0,
    status: settlement.status ?? "unknown",
    fees: settlement.fees ?? 0,
    tax: settlement.tax ?? 0,
    utr: settlement.utr ?? null,
    createdAt: settlement.created_at,
  }));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const capturedPayments = safePayments.filter((payment) => payment.status === "captured");
  const authorizedPayments = safePayments.filter((payment) => payment.status === "authorized");
  const processedSettlements = safeSettlements.filter((settlement) => settlement.status === "processed");
  const createdSettlements = safeSettlements.filter((settlement) => settlement.status === "created");

  return {
    mode: env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "live" : "test",
    pageSize: RAZORPAY_PAGE_SIZE,
    payments: { items: safePayments, skip: paymentsSkip, hasMore: payments.length === RAZORPAY_PAGE_SIZE },
    settlements: { items: safeSettlements, skip: settlementsSkip, hasMore: settlements.length === RAZORPAY_PAGE_SIZE },
    summary: {
      capturedCount: capturedPayments.length,
      capturedAmount: sum(capturedPayments.map((payment) => payment.amount)),
      authorizedCount: authorizedPayments.length,
      authorizedAmount: sum(authorizedPayments.map((payment) => payment.amount)),
      refundedAmount: sum(safePayments.map((payment) => payment.amountRefunded)),
      processedSettlementCount: processedSettlements.length,
      processedSettlementAmount: sum(processedSettlements.map((settlement) => settlement.amount)),
      pendingSettlementCount: createdSettlements.length,
      pendingSettlementAmount: sum(createdSettlements.map((settlement) => settlement.amount)),
      settlementFees: sum(processedSettlements.map((settlement) => settlement.fees)),
      settlementTax: sum(processedSettlements.map((settlement) => settlement.tax)),
      failedSettlementCount: safeSettlements.filter((settlement) => settlement.status === "failed").length,
    },
  };
}
