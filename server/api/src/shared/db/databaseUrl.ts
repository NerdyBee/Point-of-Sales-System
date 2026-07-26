import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

function loadNearestEnv() {
  let currentDirectory = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const envPath = join(currentDirectory, ".env");

    if (existsSync(envPath)) {
      config({ path: envPath });
      return;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return;
    }

    currentDirectory = parentDirectory;
  }
}

loadNearestEnv();

export function databaseUrlForMariaDbAdapter(url = process.env.DATABASE_URL ?? "") {
  return url.startsWith("mysql://") ? url.replace(/^mysql:\/\//, "mariadb://") : url;
}

export function databaseConfigForMariaDbAdapter(url = process.env.DATABASE_URL ?? "") {
  if (!url) {
    throw new Error("DATABASE_URL is required for MySQL connection");
  }

  const parsed = new URL(databaseUrlForMariaDbAdapter(url));

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "")
  };
}
