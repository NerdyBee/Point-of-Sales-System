import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { approvalsRouter } from "./modules/approvals/approvals.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { auditRouter } from "./modules/audit/audit.routes";
import { branchesRouter } from "./modules/branches/branches.routes";
import { catalogRouter } from "./modules/catalog/catalog.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { expensesRouter } from "./modules/expenses/expenses.routes";
import { healthRouter } from "./modules/health/health.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { kitchenRouter } from "./modules/kitchen/kitchen.routes";
import { restaurantRouter } from "./modules/restaurant/restaurant.routes";
import { registersRouter } from "./modules/registers/registers.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { rolesRouter } from "./modules/roles/roles.routes";
import { salesRouter } from "./modules/sales/sales.routes";
import { staffRouter } from "./modules/staff/staff.routes";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes";
import { syncRouter } from "./modules/sync/sync.routes";
import { tenantsRouter } from "./modules/tenants/tenants.routes";
import { attachTenantContext } from "./shared/http/tenantContext";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  // Replication batches (office <-> cloud) can be large; everything else keeps 1mb.
  app.use("/api/v1/sync", express.json({ limit: "25mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));
  app.use(attachTenantContext);
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/tenants", tenantsRouter);
  app.use("/api/v1/branches", branchesRouter);
  app.use("/api/v1/catalog", catalogRouter);
  app.use("/api/v1/customers", customersRouter);
  app.use("/api/v1/expenses", expensesRouter);
  app.use("/api/v1/inventory", inventoryRouter);
  app.use("/api/v1/kitchen", kitchenRouter);
  app.use("/api/v1/registers", registersRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/roles", rolesRouter);
  app.use("/api/v1/restaurant", restaurantRouter);
  app.use("/api/v1/sales", salesRouter);
  app.use("/api/v1/staff", staffRouter);
  app.use("/api/v1/subscriptions", subscriptionsRouter);
  app.use("/api/v1/sync", syncRouter);
  app.use("/api/v1/approvals", approvalsRouter);
  app.use("/api/v1/audit", auditRouter);

  return app;
}
