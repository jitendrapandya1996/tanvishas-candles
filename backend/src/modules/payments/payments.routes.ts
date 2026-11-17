import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireAdmin } from "../../middleware/require-admin.js";
import { createPaymentOrderController, razorpayDashboardController, verifyPaymentController } from "./payments.controller.js";

export const paymentRoutes = Router();
paymentRoutes.post("/orders", requireAuth, createPaymentOrderController);
paymentRoutes.post("/verify", requireAuth, verifyPaymentController);
paymentRoutes.get("/admin/dashboard", requireAuth, requireAdmin, razorpayDashboardController);
