import { subscriptionInvoiceUpdateSchema, subscriptionUpdateSchema } from "@pos/validation";
import { Router } from "express";
import { requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { getSubscriptionOverview, updateSubscriptionInvoiceStatus, updateTenantSubscription } from "./subscriptions.repository";

export const subscriptionsRouter = Router();

subscriptionsRouter.get("/current", requireTenant, requirePermission("subscription.manage"), async (req, res) => {
  const overview = await getSubscriptionOverview(req.tenantContext!.tenantId);
  res.json(overview);
});

subscriptionsRouter.patch("/current", requireTenant, requirePermission("subscription.manage"), async (req, res) => {
  const parsed = subscriptionUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid subscription payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await updateTenantSubscription(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);
  res.json({ subscription: result.subscription });
});

subscriptionsRouter.patch("/invoices/:invoiceId", requireTenant, requirePermission("subscription.manage"), async (req, res) => {
  const parsed = subscriptionInvoiceUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid invoice payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await updateSubscriptionInvoiceStatus(
    req.tenantContext!.tenantId,
    req.tenantContext!.userId,
    req.params.invoiceId.toString(),
    parsed.data.status,
    parsed.data.paymentReference
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Subscription invoice not found" });
    return;
  }

  res.json({ invoice: result.invoice });
});
