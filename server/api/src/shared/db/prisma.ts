import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { databaseConfigForMariaDbAdapter } from "./databaseUrl";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const adapter = new PrismaMariaDb(databaseConfigForMariaDbAdapter());

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
