/**
 * Creates a real client business (no demo data) on a fresh installation.
 *
 *   npm run business -- create --name "Bella Foods" --owner "Grace Mensah" --email grace@bellafoods.com
 *       --password "Secret123!" [--pin 482915] [--branch "Main"] [--city Accra] [--currency GHS]
 *       [--tax 0.15] [--plan Business] [--phone ...] [--id tenant-bella-foods]
 *   npm run business -- list
 *
 * On the cloud, run it once and office servers receive the business when they connect.
 * Offline-only offices can use the first-run setup page instead (see modules/setup).
 */
import { prisma } from "./shared/db/prisma";
import type { SubscriptionPlan } from "./shared/data/demoStore";
import { createBusiness } from "./modules/setup/setup.service";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string) {
  const value = option(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function create() {
  const business = await createBusiness({
    name: required("name"),
    ownerName: required("owner"),
    email: required("email"),
    password: required("password"),
    pin: option("pin"),
    phone: option("phone"),
    branchName: option("branch"),
    city: option("city"),
    currency: option("currency") ?? "NGN",
    taxRate: Number(option("tax") ?? 0),
    plan: option("plan") as SubscriptionPlan | undefined,
    tenantId: option("id")
  });

  console.log(`Created business "${required("name")}"`);
  console.log(`  Business ID : ${business.tenantId}`);
  console.log(`  Branch      : ${business.branchName} (${business.branchId})`);
  console.log(`  Currency    : ${business.currency}, ${business.moneyDecimals} decimal places`);
  console.log(`  Owner       : ${business.email}, staff ID ${business.staffId}`);
  console.log(`Sign in with the staff ID and password.`);
}

async function list() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, plan: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  if (!tenants.length) console.log("No businesses yet. Create one with: business create --name ...");
  for (const tenant of tenants) console.log(`${tenant.id}\t${tenant.name}\t${tenant.plan}`);
}

async function main() {
  switch (process.argv[2]) {
    case "create":
      await create();
      break;
    case "list":
      await list();
      break;
    default:
      console.log("Commands: create | list   (see the top of business-cli.ts for options)");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
