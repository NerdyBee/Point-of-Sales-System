#!/usr/bin/env node
/**
 * The bundle you send to a client: installer, installation guide and video, user manual
 * and demo video, and a START HERE note.
 *
 *   npm run package:client                 rebuilds the office installer first
 *   npm run package:client -- --skip-build use the installer already in release/
 *
 * Output: release/AjokePOS-Client-Package-<version>/ and the same as a .zip.
 * The guides and videos come from scripts/marketing (see its README); build them first.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const release = join(root, "release");
const marketing = join(release, "marketing");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const vendor = JSON.parse(readFileSync(join(root, "scripts/marketing/story.json"), "utf8")).vendor;
const name = `AjokePOS-Client-Package-${version}`;
const folder = join(release, name);

if (!process.argv.includes("--skip-build")) {
  console.log("Rebuilding the office installer...");
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "release", "--", "--office"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}

// Numbered so the files sort in the order a client should open them.
const files = [
  [join(marketing, "Ajoke-POS-Installation-Guide.pdf"), "1 - Installation Guide.pdf"],
  [join(marketing, "Ajoke-POS-Installation.mp4"), "2 - Installation Video.mp4"],
  [join(release, `AjokePOS-Office-${version}.zip`), `3 - Installer/AjokePOS-Office-${version}.zip`],
  [join(marketing, "Ajoke-POS-User-Manual.pdf"), "4 - User Manual.pdf"],
  [join(marketing, "Ajoke-POS-Demo.mp4"), "5 - Ajoke POS Tour Video.mp4"]
];

const missing = files.filter(([source]) => !existsSync(source)).map(([source]) => source);
if (missing.length) {
  console.error(`Missing:\n  ${missing.join("\n  ")}\nBuild them first (see scripts/marketing/README.md).`);
  process.exit(1);
}

rmSync(folder, { recursive: true, force: true });
for (const [source, target] of files) {
  mkdirSync(dirname(join(folder, target)), { recursive: true });
  copyFileSync(source, join(folder, target));
}

const megabytes = (path) => `${Math.round(statSync(path).size / 1048576)} MB`;
writeFileSync(
  join(folder, "START HERE.txt"),
  `AJOKE POS - START HERE
======================

Thank you for choosing Ajoke POS, the point of sale system that keeps working
without internet. This folder has everything you need.

WHAT IS IN THIS FOLDER
  1 - Installation Guide.pdf     Step-by-step installation, with pictures
  2 - Installation Video.mp4     The same steps as a short video (3 minutes)
  3 - Installer                  The Ajoke POS installation file (${megabytes(files[2][0])})
  4 - User Manual.pdf            How to use Ajoke POS every day
  5 - Ajoke POS Tour Video.mp4   A 4-minute tour of everything Ajoke POS does

WHAT TO DO
  1. Watch the installation video, or open the installation guide.
  2. Copy the zip file from the "3 - Installer" folder to the shop computer,
     right-click it, choose "Extract All", and double-click Install.cmd.
  3. Send the device code that Ajoke POS shows you to ${vendor.name} on
     WhatsApp (${vendor.phone}) to receive your activation code.
  4. Create your business, then use the user manual to add products and staff.

NEED HELP?
  ${vendor.name}
  WhatsApp ${vendor.phone}

Ajoke POS version ${version}
`.replace(/\n/g, "\r\n")
);

const archive = join(release, `${name}.zip`);
rmSync(archive, { force: true });
// Windows' built-in tar writes zip files; videos and the installer are already compressed.
execFileSync("tar.exe", ["-a", "-c", "-f", archive, name], { cwd: release, stdio: "inherit" });
console.log(`\nClient package: ${archive} (${megabytes(archive)})\nFolder:         ${folder}`);
