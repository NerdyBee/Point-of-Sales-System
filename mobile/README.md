# NaijaPOS Tablet

Offline-first point of sale for Android/iOS tablets (Expo SDK 57, React Native 0.86). It syncs with the **office server** on the shop Wi-Fi, with the **cloud**, or with both. See `../SYNC_ARCHITECTURE.md` for how sync works.

It can also run **on its own (standalone)** for very small shops that have no server. See [Standalone mode](#standalone-mode).

This app is deliberately **outside** the npm workspaces (`apps/*`, `packages/*`, `server/*`). It has its own `node_modules` and lockfile, so Expo's React/React Native versions never clash with the web app's.

## What it does
- **Setup:** choose *Office server only*, *Cloud only* or *Office server + cloud*, then enter the server address and a pairing code for each. Or choose *This device only (no server)* (see below).
- **Sign in:** staff tap their name and enter their 6-digit PIN. This is checked on the tablet, so it works offline. The till locks after 10 minutes of inactivity.
- **Register:** open with a float. Closing sends the cash count to a manager for approval in the web app.
- **Sell:** product grid with search and categories, stock left (minus sales not yet synced), customer lookup or quick add, payment by cash / card / transfer / mobile money (with reference), and an on-screen receipt.
- **Sales:** sales made on this tablet, with their sync state.
- **Sync:** server reachability, items waiting, items needing review, a log of recent commands, pairing with another server, and reset.

All actions are written to the tablet's SQLite database first and sent when a server is reachable. Totals use the same formula as the server (`src/pos/pricing.ts` mirrors `previewSaleTotal`).

## Standalone mode
On first launch, choose **This device only (no server)**, then enter the business name, currency, VAT, an optional service charge, and the owner's name and 6-digit PIN. The tablet then is the whole system:

- **Manage** tab (owner/manager), with a list, search and a floating *+* button in each section. Tap an item to edit it:
  - **Products:** name, category, price, cost, opening stock, low-stock warning, barcode. *Delete* removes a product that was never sold; a sold product is **archived** instead (hidden from Sell, restorable) so old receipts stay intact. The **Stock** tab records stock received or removed with a reason, and shows the product's stock history.
  - **Customers:** add, edit (name, phone, email, group, notes), see purchases, amount spent and loyalty points, and delete customers who have no sales.
  - **Staff:** roles (owner, manager, cashier) and personal PINs; disable or re-enable. The last owner cannot be disabled.
  - **Business:** receipt name and footer, VAT, service charge, payment methods.
- **Sell** works as usual. Sales are saved immediately, stock is deducted, and customers earn loyalty points (1 per 100 spent, as on the server). An empty catalogue offers *Add products*.
- **Sales** shows today's total, number of sales, items sold and the split by payment method, with filters (all, today, voided). Tap a sale to see its receipt. Owners and managers can **void** it with a reason, which puts the stock, loyalty points and drawer cash back.
- **Register** opens and closes on the device, showing over/short against expected cash. *Past shifts* lists earlier shifts with their result. Cashiers can open; owners and managers close.
- **Backup** exports the whole shop as a JSON file through the share sheet (Google Drive, email, WhatsApp...). The status bar warns when there is no backup or it is over 7 days old. A new or repaired tablet can restore it from the setup screen (*Restore from a backup file instead*). It works on phones as well as tablets; the layout adapts to the screen width.

Nothing is queued or sent anywhere in this mode. Data is stored in the same shape and with the same ids a server uses (`rows` tables, roles and permissions, stock movements). That way a shop can be moved onto an office or cloud server later. That migration is not built yet. A standalone tablet cannot be switched to a server mode from the app.

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
npm test                  # pricing, standalone mode, (optionally) live end-to-end
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
src/pos/                pricing (mirrors server), register/sale/customer actions, day summary
src/standalone/         no-server mode: business setup, products/stock, staff, settings, backup
src/auth/pin.ts         offline PIN check with lockout
src/shell/              app context (session, background sync, auto-lock) and tab shell
src/screens/            Setup, Lock, Sell, Register, Sales, Sync, Manage, Backup
src/ui/                 theme, form components, app kit (icons, list rows, bottom sheets, FAB), responsive layout
```
