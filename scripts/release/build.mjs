#!/usr/bin/env node
/**
 * Builds the installable Ajoke POS server (API + admin web) for clients.
 *
 *   npm run release              cloud package + Windows office package
 *   npm run release -- --cloud   cloud package only
 *   npm run release -- --office  Windows office package only (run this on Windows)
 *
 * Output (release/ is git-ignored):
 *   release/cloud/                         copy to the cloud server, then `docker compose up -d`
 *   release/AjokePOS-Office-<version>.zip  send to the client; they run Install.cmd
 *
 * See deploy/README.md for the whole process.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// Windows' own tar (it writes .zip). Not just "tar.exe": from Git Bash that finds GNU tar, which
// reads "c:\..." as a network host and fails.
const windowsTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "release");
const cache = join(out, ".cache");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

// Bundled with the office package. Update both values together (see downloads.mariadb.org).
const mariadb = {
  version: "11.8.9",
  url: "https://downloads.mariadb.org/rest-api/mariadb/11.8.9/mariadb-11.8.9-winx64.zip",
  sha256: "830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5"
};

// Packages the bundle loads at runtime (Prisma can't be bundled) plus the CLI for schema updates.
const runtimePackages = ["@prisma/client", "@prisma/adapter-mariadb", "mariadb", "prisma", "dotenv"];

const args = new Set(process.argv.slice(2));
const wantCloud = !args.has("--office");
const wantOffice = !args.has("--cloud");

function run(command, commandArgs, cwd = root) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  // npm/npx are .cmd files on Windows, started through cmd.exe (the `shell` option is deprecated).
  // Prisma's "update available" notice is about pre-release versions; not wanted in builds.
  const env = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  if (process.platform === "win32") execFileSync("cmd.exe", ["/d", "/s", "/c", command, ...commandArgs], { cwd, stdio: "inherit", env });
  else execFileSync(command, commandArgs, { cwd, stdio: "inherit", env });
}

function installedVersion(name) {
  return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;
}

/** release/server: platform-neutral app files, no node_modules. */
async function buildServer() {
  const server = join(out, "server");
  rmSync(server, { recursive: true, force: true });
  mkdirSync(join(server, "dist"), { recursive: true });

  run("npm", ["--workspace", "packages/types", "run", "build"]);
  run("npm", ["--workspace", "packages/validation", "run", "build"]);
  run("npm", ["--workspace", "apps/admin-web", "run", "build"]);

  await build({
    entryPoints: {
      server: join(root, "server/api/src/index.ts"),
      sync: join(root, "server/api/src/sync-cli.ts"),
      business: join(root, "server/api/src/business-cli.ts"),
      license: join(root, "server/api/src/license-cli.ts")
    },
    outdir: join(server, "dist"),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: runtimePackages,
    // Installed copies must be activated (modules/license). Fixed here, not in .env, so a
    // client cannot switch it off; running from source leaves it off.
    define: { "process.env.AJOKE_LICENSE": JSON.stringify("required") },
    logLevel: "info"
  });

  cpSync(join(root, "apps/admin-web/dist"), join(server, "web"), { recursive: true });
  mkdirSync(join(server, "prisma"));
  cpSync(join(root, "database/prisma/schema.prisma"), join(server, "prisma/schema.prisma"));
  writeFileSync(
    join(server, "prisma.config.mjs"),
    `import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // \`prisma generate\` runs at build time without a database, so it only needs a placeholder.
  datasource: { url: process.env.DATABASE_URL ?? "mysql://build:build@localhost:3306/build" }
});
`
  );
  writeFileSync(
    join(server, "package.json"),
    `${JSON.stringify(
      {
        name: "ajokepos-server",
        version,
        private: true,
        scripts: {
          start: "node dist/server.cjs",
          "db:push": "prisma db push",
          sync: "node dist/sync.cjs",
          business: "node dist/business.cjs"
        },
        dependencies: Object.fromEntries(runtimePackages.map((name) => [name, installedVersion(name)]))
      },
      null,
      2
    )}\n`
  );
  return server;
}

function buildCloud(server) {
  const cloud = join(out, "cloud");
  rmSync(cloud, { recursive: true, force: true });
  cpSync(join(root, "deploy/cloud"), cloud, { recursive: true });
  cpSync(server, join(cloud, "server"), { recursive: true });
  console.log(`\nCloud package: ${cloud}`);
}

async function download(url, file, sha256) {
  if (!existsSync(file)) {
    console.log(`Downloading ${url}`);
    mkdirSync(dirname(file), { recursive: true });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${file}.part`));
    renameSync(`${file}.part`, file);
  }
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== sha256) {
    rmSync(file);
    throw new Error(`Checksum mismatch for ${file}; deleted it, run the build again`);
  }
}

function powershell(script) {
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "inherit" });
}

async function buildOffice(server) {
  if (process.platform !== "win32") throw new Error("Build the office package on Windows (it bundles Windows binaries)");

  const stage = join(out, "office");
  const app = join(stage, "AjokePOS");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });

  cpSync(join(root, "deploy/office"), app, { recursive: true });
  cpSync(server, join(app, "server"), { recursive: true });
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], join(app, "server"));
  run("npx", ["prisma", "generate"], join(app, "server"));
  // Prisma keeps a download cache of its engines; the engine itself is already unpacked.
  rmSync(join(app, "server/node_modules/@prisma/engines/node_modules/.cache"), { recursive: true, force: true });
  // Prisma ships a query compiler per database; only MySQL's is used.
  const prismaRuntime = join(app, "server/node_modules/@prisma/client/runtime");
  for (const file of readdirSync(prismaRuntime)) {
    if (/\.(sqlserver|cockroachdb|postgresql|sqlite)\.|\.map$/.test(file)) rmSync(join(prismaRuntime, file));
  }

  // The Node.js that runs this build is the one shipped to the client.
  mkdirSync(join(app, "node"));
  cpSync(process.execPath, join(app, "node", "node.exe"));

  const zip = join(cache, `mariadb-${mariadb.version}-winx64.zip`);
  await download(mariadb.url, zip, mariadb.sha256);
  const unpacked = join(cache, `mariadb-${mariadb.version}-winx64`);
  if (!existsSync(unpacked)) powershell(`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${cache}' -Force`);
  // Only the programs the install, start and backup scripts use (plus their DLLs).
  // mariadb-install-db starts the server as mysqld.exe, so that copy is needed too.
  const mariadbPrograms = ["mariadbd.exe", "mysqld.exe", "mariadb.exe", "mariadb-admin.exe", "mariadb-dump.exe", "mariadb-install-db.exe", "mariadb-upgrade.exe"];
  mkdirSync(join(app, "mariadb/bin"), { recursive: true });
  for (const file of readdirSync(join(unpacked, "bin"))) {
    if (mariadbPrograms.includes(file) || file.endsWith(".dll")) cpSync(join(unpacked, "bin", file), join(app, "mariadb/bin", file));
  }
  cpSync(join(unpacked, "share"), join(app, "mariadb/share"), { recursive: true });
  cpSync(join(unpacked, "lib/plugin"), join(app, "mariadb/lib/plugin"), { recursive: true, filter: (path) => !path.endsWith(".pdb") });

  const archive = join(out, `AjokePOS-Office-${version}.zip`);
  rmSync(archive, { force: true });
  // Windows' built-in tar writes zip files much faster than Compress-Archive.
  execFileSync(windowsTar, ["-a", "-c", "-f", archive, "AjokePOS"], { cwd: stage, stdio: "inherit" });
  console.log(`\nOffice package: ${archive}`);
}

const server = await buildServer();
if (wantCloud) buildCloud(server);
if (wantOffice) await buildOffice(server);
