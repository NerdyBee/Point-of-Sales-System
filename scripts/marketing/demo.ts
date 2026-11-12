/**
 * Builds a realistic demo shop ("Green Basket Market", USD) on the packaged office server
 * and screenshots every part of the web app for the manual and the video.
 *
 *   npm run release -- --office          (once, so release/office/AjokePOS exists)
 *   python scripts/marketing/tiles.py     (product pictures)
 *   npx tsx scripts/marketing/demo.ts     -> release/marketing/shots/*.png + shots.json
 *
 * Needs the vendor signing key (mobile/.license/private-key.json) to activate the demo; the
 * code is NOT written to issued.csv. Uses Chrome or Edge from their usual install folders.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer-core";
import { issueLicense } from "../../mobile/src/license/license";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const data = JSON.parse(readFileSync(join(root, "scripts/marketing/demo-data.json"), "utf8"));
const pkg = join(root, "release/office/AjokePOS");
const out = join(root, "release/marketing");
const env = join(out, "env");
const shotsDir = join(out, "shots");
const node = join(pkg, "node/node.exe");
const mariaBin = join(pkg, "mariadb/bin");
const dbPort = 3395;
const apiPort = 4300;
const base = `http://127.0.0.1:${apiPort}`;
const dbUrl = `mysql://demo:demopw@127.0.0.1:${dbPort}/demo`;

const children: ChildProcess[] = [];
const shots: { id: string; file: string; title: string }[] = [];
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function step(message: string) {
  console.log(`\n== ${message}`);
}

// ----- environment: MariaDB + the packaged server ----------------------------------------

async function startEnvironment() {
  if (!existsSync(node)) throw new Error("Build the office package first: npm run release -- --office");
  step("Fresh database and server");
  rmSync(env, { recursive: true, force: true });
  mkdirSync(env, { recursive: true });
  execFileSync(join(mariaBin, "mariadb-install-db.exe"), [`--datadir=${join(env, "data")}`, `--port=${dbPort}`, "--password=rootpw"], { stdio: "ignore" });
  children.push(spawn(join(mariaBin, "mariadbd.exe"), [`--datadir=${join(env, "data")}`, `--port=${dbPort}`, "--console"], { stdio: "ignore" }));
  for (let attempt = 0; ; attempt += 1) {
    try {
      execFileSync(join(mariaBin, "mariadb-admin.exe"), ["--host=127.0.0.1", `--port=${dbPort}`, "ping"], { stdio: "ignore" });
      break;
    } catch {
      if (attempt > 30) throw new Error("MariaDB did not start");
      await wait(1000);
    }
  }
  execFileSync(join(mariaBin, "mariadb.exe"), ["-uroot", "-prootpw", "--host=127.0.0.1", `--port=${dbPort}`, "-e",
    "CREATE DATABASE demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'demo'@'%' IDENTIFIED BY 'demopw'; GRANT ALL ON demo.* TO 'demo'@'%';"]);

  // A copy of the server so uploads land outside the package.
  // robocopy exit codes below 8 mean success (1 = files copied).
  const copy = spawnSync("robocopy", [join(pkg, "server"), join(env, "server"), "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { stdio: "ignore" });
  if ((copy.status ?? 16) >= 8) throw new Error(`Copying the server failed (robocopy ${copy.status})`);
  const serverEnv = { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: "production", NODE_ROLE: "office", HOST: "127.0.0.1", PORT: String(apiPort), WEB_DIR: join(env, "server/web") };
  execFileSync(node, ["node_modules/prisma/build/index.js", "db", "push"], { cwd: join(env, "server"), env: serverEnv, stdio: "ignore" });
  children.push(spawn(node, ["dist/server.cjs"], { cwd: join(env, "server"), env: serverEnv, stdio: "ignore" }));
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (attempt > 60) throw new Error("Server did not start");
    await wait(1000);
  }
}

function sql(statements: string) {
  execFileSync(join(mariaBin, "mariadb.exe"), ["-uroot", "-prootpw", "--host=127.0.0.1", `--port=${dbPort}`, "demo", "-e", statements]);
}

// ----- API helpers ------------------------------------------------------------------------

let headers: Record<string, string> = {};

async function api<T = any>(path: string, init: { method?: string; body?: unknown; raw?: Buffer; type?: string } = {}): Promise<T> {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { ...headers, "content-type": init.type ?? "application/json" },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "POST"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body as T;
}

// ----- browser helpers --------------------------------------------------------------------

function findBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome or Edge not found");
  return found;
}

async function settle(page: Page, ms = 900) {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 15_000 }).catch(() => undefined);
  await wait(ms);
}

async function shot(page: Page, id: string, title: string) {
  await settle(page);
  const file = `${String(shots.length + 1).padStart(2, "0")}-${id}.png`;
  await page.screenshot({ path: join(shotsDir, file) });
  shots.push({ id, file, title });
  console.log(`  shot ${file}`);
}

const xpathText = (text: string) => `normalize-space(.)=${JSON.stringify(text)} or contains(normalize-space(.), ${JSON.stringify(text)})`;

async function click(page: Page, selector: string, text?: string) {
  // XPath when there is text to match, or when the selector is XPath (uses "[@", "//" or "[contains").
  const xpath = text || /\[@|\/\/|\[contains|\[starts-with|\[normalize-space/.test(selector);
  const handle = xpath
    ? await page.waitForSelector(`::-p-xpath(//${selector}${text ? `[${xpathText(text)}]` : ""})`, { timeout: 10_000 })
    : await page.waitForSelector(selector, { timeout: 10_000 });
  await handle!.click();
  await settle(page, 500);
}

async function nav(page: Page, label: string) {
  await click(page, `nav//button`, label).catch(async () => click(page, `aside//button`, label));
}

async function fillLabel(page: Page, label: string, value: string, tag = "input") {
  const handle = await page.waitForSelector(`::-p-xpath(//label[contains(normalize-space(.), ${JSON.stringify(label)})]//${tag})`, { timeout: 10_000 });
  await handle!.click({ count: 3 });
  await handle!.type(value);
}

/** A printed document (receipt, quotation, statement...) opens in a popup: screenshot that. */
async function popupShot(page: Page, trigger: () => Promise<void>, id: string, title: string, size: { width: number; height: number }) {
  let timer: NodeJS.Timeout | undefined;
  const opened = new Promise<Page>((resolve, reject) => {
    page.once("popup", (popup) => resolve(popup!));
    timer = setTimeout(async () => {
      // Usually a form the browser would not submit: say which field, and what the page shows.
      const why = await page.evaluate(() => {
        const invalid = [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")].filter((field) => !field.checkValidity());
        const fields = invalid.map((field) => `${field.name || field.placeholder || field.type}="${field.value}": ${field.validationMessage}`);
        const status = [...document.querySelectorAll(".status-message, [role=status], .error")].map((element) => element.textContent?.trim());
        return [...fields, ...status].filter(Boolean).join("; ");
      }).catch(() => "");
      await page.screenshot({ path: join(shotsDir, `failed-${id}.png`) }).catch(() => undefined);
      reject(new Error(`no ${id} window opened${why ? ` (${why})` : ""}`));
    }, 20_000);
  });
  await trigger();
  const popup = await opened.finally(() => clearTimeout(timer));
  await popup.setViewport({ ...size, deviceScaleFactor: 4 / 3 });
  await wait(1200);
  const file = `${String(shots.length + 1).padStart(2, "0")}-${id}.png`;
  await popup.screenshot({ path: join(shotsDir, file) });
  shots.push({ id, file, title });
  console.log(`  shot ${file} (printed document)`);
  await popup.close();
}

/** Scrolls a panel (by its heading) to the top of the screen. */
async function scrollToHeading(page: Page, heading: string) {
  await page.evaluate((text) => {
    const target = [...document.querySelectorAll("h2, h3")].find((element) => element.textContent?.trim().startsWith(text));
    if (!target) throw new Error(`No heading "${text}"`);
    const panel = target.closest("section") ?? target;
    window.scrollBy(0, panel.getBoundingClientRect().top - 90);
  }, heading);
  await settle(page);
}

/** Sets the From/To date fields in the panel under a heading (React-controlled inputs). */
async function setPanelDates(page: Page, heading: string, from: string, to: string) {
  await page.evaluate((text, values) => {
    const target = [...document.querySelectorAll("h2")].find((element) => element.textContent?.trim().startsWith(text))!;
    const inputs = [...target.closest("section")!.querySelectorAll<HTMLInputElement>("input[type=date]")];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    // "To" first so the "From" field's max allows the new start.
    for (const [index, value] of [[1, values[1]], [0, values[0]]] as const) {
      setter.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
      inputs[index].dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, heading, [from, to]);
  await settle(page, 1500);
}

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

// ----- the demo ---------------------------------------------------------------------------

async function main() {
  mkdirSync(out, { recursive: true });
  rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
  await startEnvironment();

  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ["--window-size=1440,810", "--force-device-scale-factor=1.3333333"] });
  try {
    const page = await browser.newPage();
    // 1440x810 CSS pixels at 4/3 = 1920x1080 images, the video frame size.
    await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 4 / 3 });
    page.on("dialog", (dialog) => void dialog.accept());

    step("Activation");
    await page.goto(base, { waitUntil: "networkidle0" });
    await shot(page, "activate", "Activate Ajoke POS");
    const { deviceCode } = await (await fetch(`${base}/api/v1/license`)).json();
    const secret = JSON.parse(readFileSync(join(root, "mobile/.license/private-key.json"), "utf8")).secretKey;
    const code = issueLicense(secret, { v: 1, product: "office", id: "OFF-DEMO", name: data.business.businessName, device: deviceCode, issued: new Date().toISOString().slice(0, 10), expires: null } as never);
    await page.$eval("textarea", (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, code);
    await click(page, "button", "Activate");

    step("First-run setup");
    const b = data.business;
    await page.waitForSelector("::-p-xpath(//strong[contains(., 'Welcome to Ajoke POS')])");
    await fillLabel(page, "Business name", b.businessName);
    await page.select("select", b.currency);
    await fillLabel(page, "VAT", String(b.vatPercent));
    await fillLabel(page, "Shop / branch name", b.branchName);
    await fillLabel(page, "City", b.city);
    await fillLabel(page, "Your name", b.ownerName);
    await fillLabel(page, "Email", b.email);
    await fillLabel(page, "Phone", b.phone);
    await fillLabel(page, "Password", b.password);
    await fillLabel(page, "Repeat password", b.password);
    await fillLabel(page, "6-digit PIN", b.pin);
    await fillLabel(page, "Repeat PIN", b.pin);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "setup", "Create your business");
    await click(page, "button", "Create business");
    await page.waitForSelector(".setup-staff-id");
    await shot(page, "setup-done", "Your business is ready");
    const staffId = await page.$eval(".setup-staff-id", (element) => element.textContent!.trim());
    await click(page, "button", "Continue");

    step("Demo data");
    const login = await api("/auth/login", { body: { identifier: staffId, password: b.password } });
    const branchId: string = login.staff.branchId;
    headers = { authorization: `Bearer ${login.accessToken}`, "x-tenant-id": login.staff.tenantId, "x-branch-id": branchId };
    const terminalId = `${branchId}-till-1`.slice(0, 80);
    const tenant = (await api("/tenants/current")).tenant;
    await api("/tenants/current/settings", { method: "PATCH", body: { ...tenant.settings, ...data.settings, productCategories: data.categories } });

    const tiles = join(out, "assets/products");
    if (!existsSync(tiles) || readdirSync(tiles).length < data.products.length) throw new Error("Run python scripts/marketing/tiles.py first");
    const products: { id: string; name: string; price: number; category: string }[] = [];
    for (const [index, product] of data.products.entries()) {
      const { imagePath } = await api("/catalog/product-images", { raw: readFileSync(join(tiles, `${String(index).padStart(2, "0")}.png`)), type: "image/png" });
      const sku = `GB-${String(index + 101)}`;
      const created = await api("/catalog/products", {
        body: { branchId, name: product.name, sku, barcode: `0${String(7300000000000 + index * 7919).slice(-12)}`, category: product.category, price: product.price, cost: product.cost, image: imagePath, stock: product.stock, reorderPoint: product.reorder, station: "Counter", modifiers: [] }
      });
      products.push({ ...(created.product ?? created), category: product.category });
    }
    const supplierIds: string[] = [];
    for (const supplier of data.suppliers) {
      const createdSupplier = await api("/inventory/suppliers", {
        body: { branchId, name: supplier.name, contactPerson: supplier.contactPerson, phone: supplier.phone, email: supplier.email, leadTimeDays: supplier.leadTimeDays, active: true, productIds: products.filter((product) => supplier.categories.includes(product.category)).map((product) => product.id) }
      });
      supplierIds.push(createdSupplier.supplier.id);
    }
    for (const member of data.staff) await api("/staff", { body: { branchId, ...member, pinEnabled: true, active: true } });
    const customers = [];
    for (const customer of data.customers) customers.push((await api("/customers", { body: customer })).customer);

    await api("/registers/open", { body: { branchId, terminalId, openingBalance: 20000 } });
    const pick = (name: string) => products.find((product) => product.name === name)!;
    const baskets = [
      ["Sourdough Loaf", "Whole Milk 1 L", "Free-range Eggs (12)"], ["Coffee Beans 500 g"], ["Bananas (bunch)", "Red Apples 1 kg", "Spring Water 1.5 L"],
      ["Butter Croissant", "Butter Croissant", "Fresh Orange Juice"], ["Aged Cheddar 400 g", "French Baguette", "Extra Virgin Olive Oil"], ["Dark Chocolate 70%", "Oat Cookies"],
      ["Basmati Rice 2 kg", "Vine Tomatoes 1 kg", "Avocados"], ["Wildflower Honey", "Sourdough Loaf"], ["Spring Water 1.5 L", "Spring Water 1.5 L", "Butter Croissant"],
      ["Whole Milk 1 L", "Bananas (bunch)"], ["Coffee Beans 500 g", "Butter Croissant"], ["Free-range Eggs (12)", "Vine Tomatoes 1 kg", "French Baguette"]
    ];
    let saleCount = 0;
    for (let round = 0; round < 3; round += 1) {
      for (const [index, basket] of baskets.entries()) {
        const lines = Object.entries(basket.reduce<Record<string, number>>((all, name) => ({ ...all, [name]: (all[name] ?? 0) + 1 }), {}))
          .map(([name, quantity]) => ({ productId: pick(name).id, quantity: quantity + (round === 2 && index % 4 === 0 ? 1 : 0), discount: 0 }));
        const subtotal = lines.reduce((sum, line) => sum + products.find((product) => product.id === line.productId)!.price * line.quantity, 0);
        const total = Math.round(subtotal * (1 + b.vatPercent / 100));
        const method = index % 3 === 1 ? "card" : "cash";
        const customer = index === 4 ? customers[0] : index === 7 ? customers[2] : undefined;
        const payments = method === "card" ? [{ method, amount: total, reference: `AUTH${4100 + saleCount}` }] : [{ method, amount: Math.ceil(total / 500) * 500 }];
        await api("/sales", { body: { branchId, terminalId, customerId: customer?.id, idempotencyKey: `demo-sale-${saleCount}-${Date.now()}`, lines, payments } })
          .catch(async () => api("/sales", { body: { branchId, terminalId, customerId: customer?.id, idempotencyKey: `demo-sale-b-${saleCount}-${Date.now()}`, lines, payments: [{ method, amount: total, ...(method === "card" ? { reference: `AUTH${4100 + saleCount}` } : {}) }] } }));
        saleCount += 1;
      }
    }
    // Spread today's sales over trading hours so charts look like a real day.
    // Never in the future (the sale rung up on camera must be the newest); at least 4 hours of trading.
    const end = Date.now() - 10 * 60_000;
    const opened = new Date();
    opened.setHours(7, 30, 0, 0);
    if (end - opened.getTime() < 4 * 3_600_000) opened.setTime(end - 4 * 3_600_000);
    const sales = await api("/sales?limit=100").catch(() => ({ sales: [] }));
    const saleIds: string[] = (sales.sales ?? sales.items ?? []).map((sale: { id: string }) => sale.id);
    const updates = saleIds.reverse().map((id, index) => {
      const at = new Date(opened.getTime() + 20 * 60_000 + ((end - opened.getTime() - 20 * 60_000) * (index + 0.5)) / saleIds.length);
      const stamp = at.toISOString().slice(0, 23).replace("T", " ");
      return `UPDATE completed_sales SET createdAt='${stamp}', receipt=JSON_SET(receipt, '$.createdAt', '${at.toISOString()}') WHERE id='${id}'; UPDATE payment_records SET createdAt='${stamp}' WHERE saleId='${id}';`;
    });
    if (updates.length) sql(`${updates.join(" ")} UPDATE register_shifts SET openedAt='${opened.toISOString().slice(0, 23).replace("T", " ")}';`);
    console.log(`  ${saleCount} sales`);

    for (const expense of data.expenses) {
      const spentAt = new Date(Date.now() - expense.daysAgo * 86_400_000).toISOString();
      await api("/expenses", { body: { branchId, category: expense.category, description: expense.description, vendor: expense.vendor, amount: expense.amount, paymentMethod: expense.paymentMethod, reference: expense.paymentMethod === "cash" ? "" : `EXP-${expense.daysAgo}01`, spentAt, status: "paid", note: "" } })
        .catch((error) => console.log(`  expense skipped: ${error.message}`));
    }
    await api("/approvals", { body: { branchId, type: "discount", entityType: "sale", entityId: "pending-basket", amount: 1500, reason: "Loyal customer bulk order - 10% off" } }).catch((error) => console.log(`  approval skipped: ${error.message}`));

    step("Accounts: credit customers, supplier invoices, tax");
    // Sunrise Cafe buys on account; entries are backdated so the debtors report shows real ages.
    const cafe = customers.find((customer) => customer.name === "Sunrise Cafe")!;
    await api(`/customers/${cafe.id}`, { method: "PATCH", body: { creditLimit: 250000, group: "Wholesale" } });
    const cafeEntries: [string, number, number, Record<string, string>][] = [
      ["Weekly bakery order (delivery note DN-118)", 64000, 70, {}],
      ["Coffee beans and milk (DN-131)", 42050, 35, {}],
      ["Payment on account - thank you", -30000, 20, { paymentMethod: "bank_transfer", paymentReference: "TRF-88120" }],
      ["Pastries for weekend event (DN-140)", 18520, 5, {}]
    ];
    for (const [note, amount, days, extra] of cafeEntries) {
      await api(`/customers/${cafe.id}/ledger`, { body: { type: amount > 0 ? "credit_sale" : "payment", amount, note, branchId, terminalId, ...extra } });
      sql(`UPDATE customer_ledger_entries SET createdAt='${daysAgo(days).toISOString().slice(0, 23).replace("T", " ")}' WHERE note=${JSON.stringify(note)};`);
    }
    // Other accounts brought in from the old books with the Excel import (opening balances).
    await api("/imports/customers", { body: { branchId, commit: true, rows: [
      { Name: "Harbor Point Hotel", Phone: "+1 555 0177", "Credit limit": "5000", "Opening balance": "1840.00", "Balance date": localDay(daysAgo(104)) },
      { Name: "Springfield Primary School", Phone: "+1 555 0190", "Credit limit": "3000", "Opening balance": "962.40", "Balance date": localDay(daysAgo(48)) }
    ] } });
    // Supplier invoices with VAT; one paid with withholding tax kept back.
    const invoices = [
      { supplier: 0, number: "VF-2207", issued: 52, due: 22, amount: 86400, vat: 6400 },
      { supplier: 2, number: "MW-55190", issued: 12, due: -18, amount: 151200, vat: 11200 },
      { supplier: 1, number: "GC-0931", issued: 6, due: -24, amount: 43200, vat: 3200 }
    ];
    const invoiceIds: string[] = [];
    for (const invoice of invoices) {
      const created = await api("/inventory/supplier-invoices", { body: { branchId, supplierId: supplierIds[invoice.supplier], invoiceNumber: invoice.number, invoiceDate: daysAgo(invoice.issued).toISOString(), dueDate: daysAgo(invoice.due).toISOString(), amount: invoice.amount, vatAmount: invoice.vat } });
      invoiceIds.push(created.supplierInvoice.id);
    }
    await api(`/inventory/supplier-invoices/${invoiceIds[2]}/payments`, { body: { amount: 43200, paymentMethod: "bank_transfer", reference: "TRF-90211", paidAt: daysAgo(2).toISOString(), withholdingTax: 2160 } });
    await api("/expenses", { body: { branchId, category: "Rent", description: "Shop rent", vendor: "Springfield Properties", amount: 240000, vatAmount: 0, withholdingTax: 24000, paymentMethod: "bank_transfer", reference: "RENT-11", spentAt: daysAgo(3).toISOString(), status: "paid", note: "" } })
      .catch((error) => console.log(`  rent skipped: ${error.message}`));
    // One refunded sale (through the approval steps), for the credit note.
    const refundSaleId = saleIds[saleIds.length - 3];
    const refundApproval = (await api("/approvals", { body: { branchId, type: "refund", entityType: "sale", entityId: refundSaleId, amount: 349, reason: "Damaged item returned" } })).approval;
    await api(`/approvals/${refundApproval.id}/decision`, { method: "PATCH", body: { decision: "approved", note: "Checked the item" } });
    await api(`/approvals/${refundApproval.id}/apply`, { body: { entityType: "sale", entityId: refundSaleId, type: "refund", amount: 349, note: "Damaged item returned" } });
    await api(`/sales/${refundSaleId}/refund`, { body: { amount: 349, reason: "Damaged item returned", approvalId: refundApproval.id } });

    step("Screens");
    await page.goto(base, { waitUntil: "networkidle0" });
    await nav(page, "Dashboard");
    await shot(page, "dashboard", "Dashboard");

    await nav(page, "POS Terminal");
    await shot(page, "pos", "POS terminal");
    for (const name of ["Sourdough Loaf", "Whole Milk 1 L", "Free-range Eggs (12)", "Bananas (bunch)"]) await click(page, "button[contains(@class,'product-card')]", name);
    await shot(page, "pos-cart", "Ringing up a sale");
    await click(page, "button", "Pay now").catch(() => undefined);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "pos-paid", "Sale completed");
    await popupShot(page, async () => {
      const print = await page.waitForSelector("::-p-xpath(//div[contains(@class,'receipt')]//button[contains(., 'Print')])", { timeout: 10_000 });
      await print!.click();
    }, "receipt", "Printed receipt", { width: 600, height: 1000 }).catch((error) => console.log(`  receipt popup skipped: ${error.message}`));

    await nav(page, "Sales");
    await page.$$eval("table tbody tr", (rows) => (rows[0] as HTMLElement | undefined)?.click());
    await shot(page, "sales", "Sales history and receipts");
    const search = await page.waitForSelector("input[placeholder^='Search receipt']");
    await search!.click({ count: 3 });
    await search!.type(refundSaleId);
    await settle(page);
    await page.$$eval("table tbody tr", (rows) => (rows[0] as HTMLElement | undefined)?.click());
    await settle(page);
    await popupShot(page, () => click(page, "button", "Credit note"), "credit-note", "Credit note", { width: 1000, height: 1300 })
      .catch((error) => console.log(`  credit note skipped: ${error.message}`));

    await nav(page, "Catalog");
    await shot(page, "catalog", "Products");
    await click(page, "button", "Add product").catch(() => click(page, "button", "New product"));
    await shot(page, "catalog-add", "Adding a product");
    await page.keyboard.press("Escape");
    await click(page, "button", "Cancel").catch(() => undefined);
    await click(page, "button[@aria-label='Close product modal']").catch(() => undefined);
    await click(page, "div[contains(@class,'module-heading')]//button", "Import");
    const fileInput = await page.waitForSelector(".import-modal input[type=file]");
    await (fileInput as any).uploadFile(join(root, "scripts/marketing/import-sample.xlsx"));
    await page.waitForSelector("::-p-xpath(//div[contains(@class,'import-summary')])", { timeout: 20_000 });
    await shot(page, "import", "Importing products from Excel");
    await click(page, "section[contains(@class,'import-modal')]//button[@aria-label='Close']");

    await nav(page, "Inventory");
    await shot(page, "inventory", "Stock levels and suppliers");

    await nav(page, "Customers");
    await shot(page, "customers", "Customers and credit accounts");
    await popupShot(page, () => click(page, "button[@aria-label='Print statement for Sunrise Cafe']"), "statement", "Customer statement", { width: 1000, height: 1300 })
      .catch((error) => console.log(`  statement skipped: ${error.message}`));

    step("Quotation");
    await nav(page, "Quotations");
    await click(page, "div[contains(@class,'module-heading')]//button[normalize-space(.)='Quotation']");
    await fillLabel(page, "Customer name", "Sunrise Cafe");
    await fillLabel(page, "Phone", "+1 555 0123");
    for (const [query, name] of [["coffee", "Coffee Beans 500 g"], ["croissant", "Butter Croissant"], ["juice", "Fresh Orange Juice"]]) {
      const box = await page.waitForSelector("input[placeholder^='Add item']");
      await box!.click({ count: 3 });
      await box!.type(query);
      await click(page, "ul[contains(@class,'quotation-matches')]//button", name);
    }
    // The quantity column only (owners also see a discount column).
    await page.$$eval(".quotation-lines tbody td:nth-child(2) input", (inputs, quantities) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      inputs.forEach((input, index) => {
        setter.call(input, String(quantities[index] ?? 1));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }, [6, 40, 24]);
    await fillLabel(page, "Note on the document", "Weekly delivery to the cafe included. Prices held for 14 days.");
    await shot(page, "quotation-new", "Making a quotation");
    await popupShot(page, () => click(page, "button", "Save and print"), "quotation-print", "Printed quotation", { width: 1000, height: 1300 });
    await settle(page);
    await shot(page, "quotations", "Quotations and proforma invoices");
    await click(page, "button[starts-with(@aria-label,'Sell ')]");
    await page.waitForSelector("::-p-xpath(//span[contains(., 'From quotation')])", { timeout: 20_000 });
    await shot(page, "quotation-till", "Selling a quotation at the till");
    await click(page, "div[contains(@class,'active-table-context')]//button", "Clear").catch(() => undefined);

    await nav(page, "Register");
    await shot(page, "register", "Cash register");

    await nav(page, "Expenses");
    await shot(page, "expenses", "Expenses");

    await nav(page, "Reports");
    await shot(page, "reports", "Reports");
    await scrollToHeading(page, "Who owes us");
    await shot(page, "debtors", "Debtors and creditors");
    await setPanelDates(page, "VAT and withholding tax", localDay(daysAgo(60)), localDay(new Date()));
    await scrollToHeading(page, "VAT and withholding tax");
    await shot(page, "tax", "VAT and withholding tax");
    await setPanelDates(page, "Export for accountant", localDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), localDay(new Date()));
    await scrollToHeading(page, "Export for accountant");
    await shot(page, "accountant", "Export for the accountant");
    await page.evaluate(() => window.scrollTo(0, 0));

    await nav(page, "Staff");
    await shot(page, "staff", "Staff");

    await nav(page, "Roles");
    await shot(page, "roles", "Roles and permissions");

    await nav(page, "Approvals");
    await shot(page, "approvals", "Approvals");

    await nav(page, "Branches");
    await shot(page, "branches", "Branches and tills");

    await nav(page, "Sync");
    await shot(page, "sync", "Cloud sync and tablets");

    await nav(page, "Audit");
    await shot(page, "audit", "Audit trail");

    await nav(page, "Settings");
    await shot(page, "settings", "Business settings");

    step("Sign-in screen");
    await page.evaluate(() => {
      localStorage.removeItem("naijapos.auth");
      sessionStorage.removeItem("naijapos.auth");
    });
    await page.goto(base, { waitUntil: "networkidle0" });
    await shot(page, "signin", "Staff sign-in");

    writeFileSync(join(out, "shots.json"), JSON.stringify({ business: data.business, staffId, shots }, null, 2));
    console.log(`\n${shots.length} screenshots in ${shotsDir}`);
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of children.reverse()) child.kill();
  });
