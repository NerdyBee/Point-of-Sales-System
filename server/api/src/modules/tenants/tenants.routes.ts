import { productCategoryRenameSchema, tenantSettingsSchema } from "@pos/validation";
import { Router } from "express";
import { requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import {
  appendTenantAudit,
  findRemovedProductCategoriesInUse,
  getCurrentTenant,
  renameTenantProductCategory,
  tenantBranchExists,
  updateTenantSettingsRecord
} from "./tenants.repository";

export const tenantsRouter = Router();

tenantsRouter.get("/current", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const tenant = await getCurrentTenant(req.tenantContext!.tenantId);

  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  await appendTenantAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: req.tenantContext!.branchId,
    userId: req.tenantContext!.userId,
    action: "tenant.view",
    entityType: "tenant",
    entityId: tenant.id,
    metadata: { route: "/api/v1/tenants/current" }
  });

  res.json({ tenant });
});

tenantsRouter.patch("/current/settings", requireTenant, requirePermission("settings.manage"), async (req, res) => {
  const parsed = tenantSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid tenant settings", issues: parsed.error.flatten() });
    return;
  }

  const tenant = await getCurrentTenant(req.tenantContext!.tenantId);

  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const removedCategoriesInUse = await findRemovedProductCategoriesInUse(tenant.id, parsed.data.productCategories);

  if (removedCategoriesInUse.length > 0) {
    res.status(409).json({ error: `Cannot remove categories used by products: ${removedCategoriesInUse.join(", ")}` });
    return;
  }

  if (!(await tenantBranchExists(tenant.id, parsed.data.defaultBranchId))) {
    res.status(409).json({ error: "Default branch must exist for this tenant" });
    return;
  }

  const updatedTenant = await updateTenantSettingsRecord(tenant.id, parsed.data);

  await appendTenantAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: parsed.data.defaultBranchId,
    userId: req.tenantContext!.userId,
    action: "tenant.settings_updated",
    entityType: "tenant",
    entityId: tenant.id,
    metadata: { businessName: parsed.data.businessName, currency: parsed.data.currency }
  });

  res.json({ tenant: updatedTenant });
});

tenantsRouter.patch("/current/product-categories/rename", requireTenant, requirePermission("settings.manage"), async (req, res) => {
  const parsed = productCategoryRenameSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product category rename", issues: parsed.error.flatten() });
    return;
  }

  const result = await renameTenantProductCategory(req.tenantContext!.tenantId, parsed.data.from, parsed.data.to);

  if (!result) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  if (result.status === "not_found") {
    res.status(404).json({ error: "Product category not found" });
    return;
  }

  if (result.status === "duplicate") {
    res.status(409).json({ error: "Product category already exists" });
    return;
  }

  await appendTenantAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: result.tenant.settings.defaultBranchId,
    userId: req.tenantContext!.userId,
    action: "tenant.product_category_renamed",
    entityType: "tenant",
    entityId: result.tenant.id,
    metadata: { from: result.previousCategory, to: parsed.data.to, updatedProductCount: result.updatedProductCount }
  });

  res.json({ tenant: result.tenant, updatedProductCount: result.updatedProductCount });
});
