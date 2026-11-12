import { Router, type Request } from "express";
import { canAccessAllBranches, canAccessScopedBranches, requirePermission, requireTenant, resolveBranchScope } from "../../shared/http/tenantContext";
import { getCurrentTenant } from "../tenants/tenants.repository";
import { loadVoucherData } from "./accounting.repository";
import { dayBookCsv, decimalAmount, tallyLedgersXml, tallyVouchersXml } from "./formats";
import { taxReturn, taxReturnCsv } from "./taxReturn";
import { buildVouchers, defaultLedgers, ledgersUsed, type LedgerNames } from "./vouchers";

/**
 * GET /api/v1/accounting/export?from=2026-11-01&to=2026-11-30[&branchId=]&format=
 *   summary        what the export holds (for the screen)
 *   tally          Tally vouchers XML
 *   tally-ledgers  Tally ledger masters XML (import once, before the first vouchers)
 *   csv            day book for Excel and other accounting packages
 */
export const accountingRouter = Router();

/** Ledger names saved in Settings (tenant settings "accounting"), over the defaults. */
export interface AccountingSettings extends Partial<LedgerNames> {
  /** The company's name in Tally, so the import goes into the right company. */
  tallyCompany?: string;
}

function parseDay(value: unknown, endOfDay: boolean) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);
}

function branchScope(req: Request) {
  const requested = req.query.branchId?.toString() || undefined;
  const scope = resolveBranchScope(req.tenantContext!, requested);
  if (scope.forbidden) return { forbidden: true as const };
  if (scope.branchId) return { branchIds: [scope.branchId] };
  if (canAccessAllBranches(req.tenantContext!)) return { branchIds: undefined };
  if (canAccessScopedBranches(req.tenantContext!) && scope.branchScopeIds?.length) return { branchIds: scope.branchScopeIds };
  return req.tenantContext!.branchId ? { branchIds: [req.tenantContext!.branchId] } : { forbidden: true as const };
}

accountingRouter.get("/export", requireTenant, requirePermission("reports.profit.view"), async (req, res) => {
  const from = parseDay(req.query.from, false);
  const to = parseDay(req.query.to, true);
  if (!from || !to || to < from) {
    res.status(400).json({ error: "Choose a start and end date (YYYY-MM-DD), with the end on or after the start" });
    return;
  }
  const scope = branchScope(req);
  if ("forbidden" in scope) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const format = req.query.format?.toString() ?? "summary";
  if (!["summary", "tally", "tally-ledgers", "csv"].includes(format)) {
    res.status(400).json({ error: "format must be summary, tally, tally-ledgers or csv" });
    return;
  }

  const tenantId = req.tenantContext!.tenantId;
  const tenant = await getCurrentTenant(tenantId);
  const settings = (tenant?.settings ?? {}) as { accounting?: AccountingSettings; moneyDecimals?: number; currency?: string; businessName?: string };
  const { tallyCompany, ...ledgerOverrides } = settings.accounting ?? {};
  const ledgers: LedgerNames = { ...defaultLedgers, ...Object.fromEntries(Object.entries(ledgerOverrides).filter(([, value]) => typeof value === "string" && value.trim())) };
  const decimals = settings.moneyDecimals ?? 0;

  const data = await loadVoucherData({ tenantId, from, to, branchIds: scope.branchIds });
  const vouchers = buildVouchers({ ...data, ledgers });
  const range = `${req.query.from}-to-${req.query.to}`;

  if (format === "summary") {
    const byType = vouchers.reduce<Record<string, { count: number; total: number }>>((totals, voucher) => {
      const current = totals[voucher.type] ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += voucher.lines.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0);
      totals[voucher.type] = current;
      return totals;
    }, {});
    res.json({ from: req.query.from, to: req.query.to, currency: settings.currency, ledgers, tallyCompany: tallyCompany ?? "", voucherCount: vouchers.length, byType });
    return;
  }

  if (format === "csv") {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="ajokepos-day-book-${range}.csv"`);
    res.send(`﻿${dayBookCsv(vouchers, { decimals, branchName: data.branchName })}`);
    return;
  }

  res.setHeader("content-type", "application/xml; charset=utf-8");
  if (format === "tally-ledgers") {
    const expenseCategories = [...new Set(data.expenses.map((expense) => expense.category))];
    res.setHeader("content-disposition", `attachment; filename="ajokepos-tally-ledgers-${range}.xml"`);
    res.send(tallyLedgersXml(ledgersUsed(vouchers, ledgers, expenseCategories), tallyCompany));
    return;
  }
  res.setHeader("content-disposition", `attachment; filename="ajokepos-tally-vouchers-${range}.xml"`);
  res.send(tallyVouchersXml(vouchers, { company: tallyCompany, decimals }));
});


/**
 * GET /api/v1/accounting/tax-return?from&to[&branchId=]&format=summary|csv
 * VAT return (output VAT less input VAT) and withholding tax schedule for the period.
 */
accountingRouter.get("/tax-return", requireTenant, requirePermission("reports.profit.view"), async (req, res) => {
  const from = parseDay(req.query.from, false);
  const to = parseDay(req.query.to, true);
  if (!from || !to || to < from) {
    res.status(400).json({ error: "Choose a start and end date (YYYY-MM-DD), with the end on or after the start" });
    return;
  }
  const scope = branchScope(req);
  if ("forbidden" in scope) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const tenant = await getCurrentTenant(req.tenantContext!.tenantId);
  const settings = (tenant?.settings ?? {}) as { moneyDecimals?: number; currency?: string; taxId?: string };
  const data = await loadVoucherData({ tenantId: req.tenantContext!.tenantId, from, to, branchIds: scope.branchIds });
  const result = taxReturn(data);

  if (req.query.format === "csv") {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="ajokepos-vat-wht-${req.query.from}-to-${req.query.to}.csv"`);
    res.send(`﻿${taxReturnCsv(result, { from: String(req.query.from), to: String(req.query.to), amount: (value) => decimalAmount(value, settings.moneyDecimals ?? 0), branchName: data.branchName })}`);
    return;
  }
  res.json({
    from: req.query.from,
    to: req.query.to,
    currency: settings.currency,
    taxId: settings.taxId ?? "",
    ...result,
    withholding: { ...result.withholding, rows: result.withholding.rows.map((row) => ({ ...row, branchName: data.branchName(row.branchId) })) }
  });
});
