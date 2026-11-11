/**
 * Times the screens that grow with a business's history, against a running server.
 *
 *   npx tsx scripts/perf/measure.mts --url http://127.0.0.1:4500 --staff GRE-DOW-MAR --password "..."
 *
 * Each request is made a few times; the median time and the response size are printed, so
 * runs before and after a change (or with more data) can be compared.
 */
function option(name: string, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const base = option("url", "http://127.0.0.1:4500");
const runs = Number(option("runs", "3"));

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier: option("staff"), password: option("password") })
}).then((response) => response.json());
if (!login.accessToken) throw new Error(`Sign-in failed: ${JSON.stringify(login)}`);
const headers = { authorization: `Bearer ${login.accessToken}`, "x-tenant-id": login.staff.tenantId };

const today = new Date();
today.setHours(0, 0, 0, 0);
const screens: [string, string][] = [
  ["Dashboard (today)", `/api/v1/reports/dashboard?period=all&startDate=${today.toISOString()}`],
  ["Dashboard (this month)", "/api/v1/reports/dashboard?period=month"],
  ["Dashboard (this year)", "/api/v1/reports/dashboard?period=year"],
  ["Sales list (default)", "/api/v1/sales"],
  ["Sales list (one day)", `/api/v1/sales?from=${today.toISOString()}`],
  ["Sales search (receipt no.)", "/api/v1/sales?search=INV-0000"],
  ["Audit log", "/api/v1/audit"],
  ["Approvals", "/api/v1/approvals"],
  ["Expenses", "/api/v1/expenses"],
  ["Customers", "/api/v1/customers"],
  ["Stock", "/api/v1/inventory/stock"],
  ["Register", "/api/v1/registers/current"]
];

console.log(`${"Screen".padEnd(26)} ${"median".padStart(9)} ${"size".padStart(10)}`);
for (const [name, path] of screens) {
  const times: number[] = [];
  let size = 0;
  let status = 0;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const response = await fetch(`${base}${path}`, { headers });
    const body = await response.arrayBuffer();
    times.push(performance.now() - started);
    size = body.byteLength;
    status = response.status;
  }
  times.sort((left, right) => left - right);
  const median = times[Math.floor(times.length / 2)];
  const shown = status === 200 ? `${(size / 1024).toFixed(0)} KB` : `HTTP ${status}`;
  console.log(`${name.padEnd(26)} ${`${Math.round(median)} ms`.padStart(9)} ${shown.padStart(10)}`);
}
