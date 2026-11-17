import type { NextFunction, Request, Response } from "express";
import { createPaymentOrder, getRazorpayDashboard, handleRazorpayWebhook, verifyPayment } from "./payments.service.js";
import { createPaymentOrderSchema, verifyPaymentSchema } from "./payments.schema.js";

export async function createPaymentOrderController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = createPaymentOrderSchema.parse(req.body);
    res.json(await createPaymentOrder(orderId, req.userId!));
  } catch (error) { next(error); }
}

export async function verifyPaymentController(req: Request, res: Response, next: NextFunction) {
  try {
    const body = verifyPaymentSchema.parse(req.body);
    res.json(await verifyPayment(body, req.userId!));
  } catch (error) { next(error); }
}

export async function razorpayWebhookController(req: Request, res: Response) {
  try {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid webhook body" });
      return;
    }
    await handleRazorpayWebhook(req.body, req.header("x-razorpay-signature"));
    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    if (message.startsWith("Invalid Razorpay webhook") || message === "Invalid webhook body") {
      res.status(400).json({ error: message });
      return;
    }
    console.error("Razorpay webhook processing failed", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

export async function razorpayDashboardController(req: Request, res: Response) {
  const readSkip = (value: unknown) => {
    const parsed = typeof value === "string" ? Number(value) : 0;
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : null;
  };
  const paymentsSkip = readSkip(req.query.paymentsSkip);
  const settlementsSkip = readSkip(req.query.settlementsSkip);
  const readTimestamp = (value: unknown) => {
    if (value === undefined) return undefined;
    const parsed = typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  const from = readTimestamp(req.query.from);
  const to = readTimestamp(req.query.to);
  if (
    paymentsSkip === null || settlementsSkip === null || from === null || to === null
    || (from !== undefined && to !== undefined && from > to)
  ) {
    res.status(400).json({ error: "Invalid Razorpay dashboard page." });
    return;
  }
  try {
    res.json(await getRazorpayDashboard(paymentsSkip, settlementsSkip, from, to));
  } catch (error) {
    console.error("Razorpay admin dashboard request failed", error);
    res.status(502).json({ error: error instanceof Error ? error.message : "Razorpay dashboard data could not be loaded." });
  }
}
