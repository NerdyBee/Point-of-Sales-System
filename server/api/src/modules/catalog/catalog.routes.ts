import { Router, raw, type Request } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { productInputSchema } from "@pos/validation";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requireAnyPermission, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import {
  appendCatalogAudit,
  catalogBranchExists,
  catalogBarcodeExists,
  catalogSkuExists,
  createCatalogProductRecord,
  getCatalogProductRecord,
  getTenantSettings,
  listCatalogProducts,
  updateCatalogProductRecord
} from "./catalog.repository";

export const catalogRouter = Router();

const uploadContentTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const uploadExtensions: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

function safeUploadName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "product";
}

function requestedBranch(req: Request) {
  const requested = req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (requested) return requested;
  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function effectiveBranchScope(scope: ReturnType<typeof resolveBranchScope>, requestedBranchId?: string) {
  return !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined } : scope;
}

async function categoryAllowed(tenantId: string, category: string) {
  const settings = await getTenantSettings(tenantId);
  return Boolean(settings?.productCategories.includes(category));
}

catalogRouter.get("/products", requireTenant, requireAnyPermission(["sale.create", "catalog.manage", "inventory.adjust", "restaurant.manage"]), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const effectiveScope = effectiveBranchScope(scope, requestedBranchId);
  const tenantProducts = await listCatalogProducts(req.tenantContext!.tenantId, {
    branchId: effectiveScope.branchId,
    branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined
  });

  await appendCatalogAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: effectiveScope.branchId,
    userId: req.tenantContext!.userId,
    action: "catalog.view",
    entityType: "product",
    entityId: "collection",
    metadata: { count: tenantProducts.length, branchId: effectiveScope.branchId, branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined }
  });

  res.json({ products: tenantProducts });
});

catalogRouter.post(
  "/product-images",
  requireTenant,
  requirePermission("catalog.manage"),
  raw({ limit: "5mb", type: uploadContentTypes }),
  async (req, res) => {
    const branchId = req.header("x-branch-id")?.trim();
    const scope = resolveBranchScope(req.tenantContext!, branchId);

    if (!branchId || scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
      res.status(403).json({ error: "Branch access denied" });
      return;
    }

    if (!(await catalogBranchExists(req.tenantContext!.tenantId, scope.branchId ?? branchId))) {
      res.status(404).json({ error: "Product branch not found for this tenant" });
      return;
    }

    const contentType = req.header("content-type")?.split(";")[0].toLowerCase() ?? "";

    if (!uploadContentTypes.includes(contentType)) {
      res.status(415).json({ error: "Upload a PNG, JPG, WEBP, or GIF product image" });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Product image file is required" });
      return;
    }

    const uploadsDir = path.resolve(process.cwd(), "uploads", "products");
    await mkdir(uploadsDir, { recursive: true });
    const originalName = safeUploadName(req.header("x-file-name") ?? "product");
    const extension = uploadExtensions[contentType];
    const fileName = `${req.tenantContext!.tenantId}-${Date.now()}-${originalName.replace(/\.[^.]+$/, "")}${extension}`;
    await writeFile(path.join(uploadsDir, fileName), req.body);

    res.status(201).json({ imagePath: `/uploads/products/${fileName}` });
  }
);

catalogRouter.post("/products", requireTenant, requirePermission("catalog.manage"), async (req, res) => {
  const parsed = productInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product payload", issues: parsed.error.flatten() });
    return;
  }

  const duplicateSku = await catalogSkuExists(req.tenantContext!.tenantId, parsed.data.sku);

  if (duplicateSku) {
    res.status(409).json({ error: "SKU already exists for this tenant" });
    return;
  }

  const duplicateBarcode = await catalogBarcodeExists(req.tenantContext!.tenantId, parsed.data.barcode);

  if (duplicateBarcode) {
    res.status(409).json({ error: "Barcode already exists for this tenant" });
    return;
  }

  if (!(await catalogBranchExists(req.tenantContext!.tenantId, parsed.data.branchId))) {
    res.status(404).json({ error: "Product branch not found for this tenant" });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const settings = await getTenantSettings(req.tenantContext!.tenantId);

  if (!settings) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  if (!settings.productCategories.includes(parsed.data.category)) {
    res.status(409).json({ error: "Product category is not configured for this tenant" });
    return;
  }

  const product = await createCatalogProductRecord(req.tenantContext!.tenantId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId,
    taxRate: parsed.data.taxRate ?? settings.defaultTaxRate
  });

  await appendCatalogAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: product.branchId,
    userId: req.tenantContext!.userId,
    action: "product.created",
    entityType: "product",
    entityId: product.id,
    metadata: { sku: product.sku, price: product.price }
  });

  res.status(201).json({ product });
});

catalogRouter.patch("/products/:productId", requireTenant, requirePermission("catalog.manage"), async (req, res) => {
  const parsed = productInputSchema.partial().safeParse(req.body);
  const productId = req.params.productId.toString();

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product payload", issues: parsed.error.flatten() });
    return;
  }

  const existingProduct = await getCatalogProductRecord(req.tenantContext!.tenantId, productId);

  if (!existingProduct) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const existingScope = resolveBranchScope(req.tenantContext!, existingProduct.branchId);
  if (existingScope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !existingScope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  if (parsed.data.sku) {
    const duplicateSku = await catalogSkuExists(req.tenantContext!.tenantId, parsed.data.sku, productId);

    if (duplicateSku) {
      res.status(409).json({ error: "SKU already exists for this tenant" });
      return;
    }
  }

  if (parsed.data.barcode) {
    const duplicateBarcode = await catalogBarcodeExists(req.tenantContext!.tenantId, parsed.data.barcode, productId);

    if (duplicateBarcode) {
      res.status(409).json({ error: "Barcode already exists for this tenant" });
      return;
    }
  }

  if (parsed.data.category && !(await categoryAllowed(req.tenantContext!.tenantId, parsed.data.category))) {
    res.status(409).json({ error: "Product category is not configured for this tenant" });
    return;
  }

  if (parsed.data.branchId && !(await catalogBranchExists(req.tenantContext!.tenantId, parsed.data.branchId))) {
    res.status(404).json({ error: "Product branch not found for this tenant" });
    return;
  }

  if (parsed.data.branchId) {
    const nextScope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
    if (nextScope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !nextScope.branchId)) {
      res.status(403).json({ error: "Branch access denied" });
      return;
    }
  }

  const product = await updateCatalogProductRecord(req.tenantContext!.tenantId, productId, parsed.data);

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  await appendCatalogAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: product.branchId,
    userId: req.tenantContext!.userId,
    action: "product.updated",
    entityType: "product",
    entityId: product.id,
    metadata: { sku: product.sku, fields: Object.keys(parsed.data) }
  });

  res.json({ product });
});
