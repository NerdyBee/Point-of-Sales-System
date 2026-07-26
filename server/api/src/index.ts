import { createApp } from "./app";

export const apiModules = [
  "tenants",
  "branches",
  "auth",
  "catalog",
  "orders",
  "payments",
  "inventory",
  "purchasing",
  "registers",
  "reports",
  "subscriptions",
  "audit"
];

const port = Number(process.env.PORT ?? 4000);

if (process.env.NODE_ENV !== "test") {
  createApp().listen(port, () => {
    console.log(`NaijaPOS API listening on http://127.0.0.1:${port}`);
  });
}
