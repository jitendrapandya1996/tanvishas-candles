import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase.js";

/** Require an authenticated store owner or staff member for private admin APIs. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", req.userId);
    if (error) {
      console.error("Could not check admin permission", error);
      res.status(503).json({ error: "Admin access could not be checked. Please try again." });
      return;
    }
    if (!data?.some(({ role }) => role === "owner" || role === "staff")) {
      res.status(403).json({ error: "Store admin access required" });
      return;
    }
    next();
  } catch (error) {
    console.error("Admin permission check failed", error);
    res.status(503).json({ error: "Admin access could not be checked. Please try again." });
  }
}
