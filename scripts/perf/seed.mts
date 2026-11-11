/**
 * Fills a TEST database with a long trading history, to check the app stays fast.
 * Never point it at a client's database.
 *
 *   $env:DATABASE_URL="mysql://pos:pospw@127.0.0.1:3393/perf"
 *   npx tsx scripts/perf/seed.mts --sales 1000000 --days 730
 *   npx tsx scripts/perf/seed.mts --sales 900000 --days 1825 --older-than 365   (older history only)
 *
 * Needs a business with at least one real sale made through the app (the template every
 * generated sale copies, so rows are the same shape and size as real ones). For each day
 * and branch it adds a closed register shift; each sale gets its payment and audit event.
 * Database triggers stay on, so the sync change log grows as it would in a real shop.
 */
import { randomUUID } from "node:crypto";
import mariadb from "mariadb";

function option(name: string, fallback: number) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

const totalSales = option("sales", 100_000);
const days = option("days", 365);
// Ends this many days ago, to add old history without changing recent periods.
const olderThan = option("older-than", 0);
const url = new URL(process.env.DATABASE_URL ?? "");
if (!url.hostname) throw new Error("Set DATABASE_URL to the TEST database");

const pool = mariadb.createPool({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectionLimit: 2,
  bigIntAsNumber: true
});

const db = await pool.getConnection();
try {
  const [template] = await db.query("SELECT * FROM completed_sales ORDER BY createdAt LIMIT 1");
  if (!template) throw new Error("Make one sale in the app first; generated sales copy it.");
  const branches: { id: string }[] = await db.query("SELECT id FROM branches WHERE tenantId = ?", [template.tenantId]);
  const terminals: { id: string; branchId: string }[] = await db.query("SELECT id, branchId FROM terminals WHERE tenantId = ?", [template.tenantId]);
  const [payment] = await db.query("SELECT method, amount FROM payment_records WHERE saleId = ?", [template.id]);
  const summary = typeof template.summary === "string" ? JSON.parse(template.summary) : template.summary;
  const receipt = typeof template.receipt === "string" ? JSON.parse(template.receipt) : template.receipt;
  const tillFor = (branchId: string) => terminals.find((terminal) => terminal.branchId === branchId)?.id ?? template.terminalId;

  const perDay = Math.max(1, Math.round(totalSales / days / branches.length));
  const started = Date.now();
  let made = 0;
  console.log(`Adding about ${perDay * days * branches.length} sales over ${days} days in ${branches.length} branch(es)...`);

  for (let day = days; day >= 1 && made < totalSales; day -= 1) {
    const opened = new Date();
    opened.setHours(8, 0, 0, 0);
    opened.setDate(opened.getDate() - day - olderThan);
    const shifts: unknown[][] = [];
    const sales: unknown[][] = [];
    const payments: unknown[][] = [];
    const audits: unknown[][] = [];

    for (const branch of branches) {
      const shiftId = `perf-shift-${randomUUID()}`;
      const till = tillFor(branch.id);
      shifts.push([shiftId, template.tenantId, branch.id, till, template.cashierId, "closed", 20000, 20000, 20000, 0, opened, new Date(opened.getTime() + 12 * 3_600_000)]);
      for (let index = 0; index < perDay && made < totalSales; index += 1, made += 1) {
        const at = new Date(opened.getTime() + 30 * 60_000 + Math.floor((index / perDay) * 11 * 3_600_000));
        const saleId = `PERF-${olderThan ? "O" : ""}${made.toString(36).toUpperCase().padStart(6, "0")}-${randomUUID().slice(0, 6)}`;
        sales.push([saleId, template.tenantId, branch.id, till, shiftId, template.cashierId, `perf-${saleId}`, JSON.stringify(summary), "completed", 0, JSON.stringify({ ...receipt, createdAt: at.toISOString() }), at, at]);
        payments.push([`perf-pay-${saleId}`, template.tenantId, branch.id, saleId, shiftId, payment?.method ?? "cash", payment?.amount ?? summary.total, "reconciled", at]);
        audits.push([`perf-audit-${saleId}`, template.tenantId, branch.id, template.cashierId, "sale.completed", "sale", saleId, JSON.stringify({ total: summary.total }), at]);
      }
    }

    await db.beginTransaction();
    await db.batch("INSERT INTO register_shifts (id, tenantId, branchId, terminalId, cashierId, status, openingBalance, expectedCash, countedCash, variance, openedAt, closedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", shifts);
    if (sales.length) {
      await db.batch("INSERT INTO completed_sales (id, tenantId, branchId, terminalId, shiftId, cashierId, idempotencyKey, summary, status, refundTotal, receipt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", sales);
      await db.batch("INSERT INTO payment_records (id, tenantId, branchId, saleId, shiftId, method, amount, reconciliationStatus, createdAt) VALUES (?,?,?,?,?,?,?,?,?)", payments);
      await db.batch("INSERT INTO audit_events (id, tenantId, branchId, userId, action, entityType, entityId, metadata, createdAt) VALUES (?,?,?,?,?,?,?,?,?)", audits);
    }
    await db.commit();
    if (day % 30 === 0) console.log(`  ${made.toLocaleString()} sales (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  console.log(`Done: ${made.toLocaleString()} sales in ${Math.round((Date.now() - started) / 1000)}s`);
} finally {
  db.release();
  await pool.end();
}
