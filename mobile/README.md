# NaijaPOS Tablet

Offline-first point of sale for Android/iOS tablets (Expo SDK 57, React Native 0.86). It syncs with the **office server** on the shop Wi-Fi, with the **cloud**, or with both. See `../SYNC_ARCHITECTURE.md` for how sync works.

This app is deliberately **outside** the npm workspaces (`apps/*`, `packages/*`, `server/*`). It has its own `node_modules` and lockfile, so Expo's React/React Native versions never clash with the web app's.

## What it does
- **Setup:** choose *Office server only*, *Cloud only* or *Office server + cloud*, then enter the server address and a pairing code for each.
- **Sign in:** staff tap their name and enter their 6-digit PIN. This is checked on the tablet, so it works offline. The till locks after 10 minutes of inactivity.
- **Register:** open with a float. Closing sends the cash count to a manager for approval in the web app.
- **Sell:** product grid with search and categories, stock left (minus sales not yet synced), customer lookup or quick add, payment by cash / card / transfer / mobile money (with reference), and an on-screen receipt.
- **Sales:** sales made on this tablet, with their sync state.
- **Sync:** server reachability, items waiting, items needing review, a log of recent commands, pairing with another server, and reset.

All actions are written to the tablet's SQLite database first and sent when a server is reachable. Totals use the same formula as the server (`src/pos/pricing.ts` mirrors `previewSaleTotal`).

## Run it
```bash
cd mobile
npm install
npx expo start            # scan with Expo Go, or press a / i
```
expo-sqlite, expo-crypto and expo-secure-store ship in Expo Go, so no custom build is needed for development. For a standalone APK:
```bash
npx eas-cli@latest build --platform android --profile preview
```

### Pairing a tablet
1. In the web admin (office or cloud), open **Sync monitor → Pair a tablet**, pick the terminal the tablet acts as, and create a code. You can also run `npm run sync -- pair-device --terminal terminal-web-2 --name "Tablet 1"` on the server.
2. On the tablet, enter the server address and the code. For the office server, use the office PC's LAN address, e.g. `http://192.168.1.10:4000`. The API listens on all interfaces, but allow port 4000 through the Windows firewall.
3. For *Office server + cloud*, create a second code on the cloud for the **same terminal**.

Plain `http://` to the office server is allowed via `usesCleartextTraffic` (Android) and `NSAllowsLocalNetworking` (iOS) in `app.json`. Use `https://` for the cloud.

## Develop
```bash
npm run typecheck
npm test                  # pricing + (optionally) live end-to-end
```
The core (`src/data`, `src/sync`, `src/pos`, `src/auth`) has no React Native imports. Tests run it on Node's built-in `node:sqlite` (`test/nodePlatform.ts`) with the same SQL the app uses.

`test/e2e.test.ts` drives the real sync engine against a running server: pairing, initial download, PIN sign-in, opening a shift, a cash sale with a new customer, a card sale, an outage while selling, recovery, and closing:
```bash
NAIJAPOS_OFFICE_URL=http://127.0.0.1:4000 NAIJAPOS_OFFICE_CODE=ABCD-EFGH npm test
```

## Layout
```
App.tsx                 opens SQLite, runs migrations, renders the shell
src/data/               Db interface, expo adapter, schema, read-model queries
src/sync/               engine (pull read model, push command outbox), settings, wire types
src/pos/                pricing (mirrors server), register/sale/customer actions
src/auth/pin.ts         offline PIN check with lockout
src/shell/              app context (session, background sync, auto-lock) and tab shell
src/screens/            Setup, Lock, Sell, Register, Sales, Sync
```
