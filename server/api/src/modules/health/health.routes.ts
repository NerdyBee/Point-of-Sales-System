import { Router } from "express";
import { prisma } from "../../shared/db/prisma";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "naijapos-api"
  });
});

healthRouter.get("/db", async (_req, res) => {
  try {
    const tenantCount = await prisma.tenant.count();
    res.json({
      status: "ok",
      database: "mysql",
      tenants: tenantCount
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      database: "mysql",
      error: error instanceof Error ? error.message : "Database connection failed"
    });
  }
});
