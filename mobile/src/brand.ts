import appConfig from "../app.json";

/** Product branding shown in the app, on receipts and in shared messages. */
export const BRAND = {
  appName: "Ajoke POS",
  developer: "Ajoke Code Sphere",
  version: appConfig.expo.version
};

export const aboutLine = `${BRAND.appName} v${BRAND.version} · Developed by ${BRAND.developer}`;
