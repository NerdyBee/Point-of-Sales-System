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
  const handle = text
    ? await page.waitForSelector(`::-p-xpath(//${selector}[${xpathText(text)}])`, { timeout: 10_000 })
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
    for (const supplier of data.suppliers) {
      await api("/inventory/suppliers", {
        body: { branchId, name: supplier.name, contactPerson: supplier.contactPerson, phone: supplier.phone, email: supplier.email, leadTimeDays: supplier.leadTimeDays, active: true, productIds: products.filter((product) => supplier.categories.includes(product.category)).map((product) => product.id) }
      });
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
    const opened = new Date();
    opened.setHours(7, 30, 0, 0);
    const end = Math.max(Date.now() - 10 * 60_000, opened.getTime() + 8 * 3_600_000);
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

    step("Screens");
    await page.goto(base, { waitUntil: "networkidle0" });
    await nav(page, "Dashboard");
    await shot(page, "dashboard", "Dashboard");

    await nav(page, "POS Terminal");
    await shot(page, "pos", "POS terminal");
    for (const name of ["Sourdough Loaf", "Whole Milk 1 L", "Free-range Eggs (12)", "Bananas (bunch)"]) await click(page, "button[contains(@class,'product-card')]", name);
    await shot(page, "pos-cart", "Ringing up a sale");
    await click(page, "button", "Pay now").catch(() => undefined);
    await shot(page, "pos-paid", "Sale completed");

    await nav(page, "Sales");
    await page.$$eval("table tbody tr", (rows) => (rows[0] as HTMLElement | undefined)?.click());
    await shot(page, "sales", "Sales history and receipts");

    await nav(page, "Catalog");
    await shot(page, "catalog", "Products");
    await click(page, "button", "Add product").catch(() => click(page, "button", "New product"));
    await shot(page, "catalog-add", "Adding a product");
    await page.keyboard.press("Escape");
    await click(page, "button", "Cancel").catch(() => undefined);

    await nav(page, "Inventory");
    await shot(page, "inventory", "Stock levels and suppliers");

    await nav(page, "Customers");
    await shot(page, "customers", "Customers and credit accounts");

    await nav(page, "Register");
    await shot(page, "register", "Cash register");

    await nav(page, "Expenses");
    await shot(page, "expenses", "Expenses");

    await nav(page, "Reports");
    await shot(page, "reports", "Reports");

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
