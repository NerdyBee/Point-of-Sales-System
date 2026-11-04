/**
 * Activation from the command line (support, or servers without a browser):
 *
 *   node dist/license.cjs status                 device code, licence and expiry
 *   node dist/license.cjs activate --code <code> store an activation code for this computer
 *
 * The same can be done in the web app, which shows the activation page until activated.
 */
import { prisma } from "./shared/db/prisma";
import { activateLicense, licenseState, publicLicenseState } from "./modules/license/license";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  switch (process.argv[2]) {
    case "status": {
      const state = publicLicenseState(await licenseState(true));
      console.log(`Device code : ${state.deviceCode}`);
      console.log(state.active ? `Activated   : ${state.licensedTo}, ${state.expires ? `valid until ${state.expires}` : "no expiry"}` : `Not active  : ${state.message}`);
      break;
    }
    case "activate": {
      const code = option("code");
      if (!code) throw new Error("Usage: activate --code <activation code>");
      const state = publicLicenseState(await activateLicense(code));
      if (!state.active) throw new Error(state.message);
      console.log(`Activated for ${state.licensedTo}${state.expires ? `, valid until ${state.expires}` : ", no expiry"}.`);
      break;
    }
    default:
      console.log("Commands: status | activate --code <activation code>");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
