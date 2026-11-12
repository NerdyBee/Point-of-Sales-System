import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { canAccessAllBranches, requirePermission, requireTenant, resolveBranchScope } from "../../shared/http/tenantContext";
import { getTenantSettings } from "../catalog/catalog.repository";
import { customerRows, productRows, supplierBalanceRows, type RawRow, type RowResult } from "./importRows";
import { importCustomers, importProducts, importSupplierBalances, type ImportContext, type ImportOutcome } from "./imports.service";

/**
 * Spreadsheet imports. The web app reads the Excel or CSV file and sends its rows; each
 * endpoint checks every row and, only when `commit` is true, saves the good ones.
 *   POST /api/v1/imports/products           (catalog.manage)
 *   POST /api/v1/imports/customers          (customer.manage)
 *   POST /api/v1/imports/supplier-balances  (inventory.adjust)
 * Body: { branchId, rows: [{ header: value }], commit }
 */
export const importsRouter = Router();

const bodySchema = z.object({
  branchId: z.string().min(1),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(5000),
  commit: z.boolean().default(false)
});

function handler<T>(parse: (rows: RawRow[], decimals: number) => RowResult<T>[], run: (context: ImportContext, rows: RowResult<T>[]) => Promise<ImportOutcome[]>) {
  return async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send a branch and between 1 and 5,000 rows" });
      return;
    }
    const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
    if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
      res.status(403).json({ error: "Branch access denied" });
      return;
    }
    const settings = await getTenantSettings(req.tenantContext!.tenantId);
    const rows = parse(parsed.data.rows, (settings as { moneyDecimals?: number } | null)?.moneyDecimals ?? 0);
    const outcomes = await run({ tenantId: req.tenantContext!.tenantId, userId: req.tenantContext!.userId, branchId: scope.branchId ?? parsed.data.branchId, commit: parsed.data.commit }, rows);
    res.json({
      committed: parsed.data.commit,
      created: outcomes.filter((item) => item.action === "create").length,
      updated: outcomes.filter((item) => item.action === "update").length,
      skipped: outcomes.filter((item) => item.action === "skip").length,
      rows: outcomes
    });
  };
}

importsRouter.post("/products", requireTenant, requirePermission("catalog.manage"), handler(productRows, importProducts));
importsRouter.post("/customers", requireTenant, requirePermission("customer.manage"), handler(customerRows, importCustomers));
importsRouter.post("/supplier-balances", requireTenant, requirePermission("inventory.adjust"), handler(supplierBalanceRows, importSupplierBalances));
