# NaijaPOS Startup Instructions

Use these steps from the project root:

```powershell
cd C:\Users\DELL\Dev\pos
```

## 1. Check Environment

Make sure `.env` exists and points to the local MySQL database:

```env
DATABASE_URL="mysql://root:GrinDa@localhost:3306/naijapos"
```

Install dependencies if this is a fresh machine or `node_modules` is missing:

```powershell
npm install
```

## 2. Start MySQL

Start MySQL from XAMPP, Laragon, MySQL service, or your preferred local MySQL manager.

The app expects:

- Host: `localhost`
- Port: `3306`
- Database: `naijapos`
- User: `root`

## 3. Prepare Database

Generate Prisma client:

```powershell
npm run db:generate
```

Create/update tables:

```powershell
npm run db:push
```

Seed demo data:

```powershell
npm run db:seed
```

To clear and reseed everything:

```powershell
npm run db:reset
```

## 4. Start API Server

Open a terminal and run:

```powershell
cd C:\Users\DELL\Dev\pos
npm run dev:api
```

Expected API URL:

```text
http://127.0.0.1:4000
```

Authentication is token-based after login. Do not set `ALLOW_HEADER_AUTH=true` for normal local or production runs; that switch is only for isolated development/debugging where you intentionally want to accept `x-tenant-id`, `x-role`, and `x-user-id` headers without a bearer token.

## 5. Start Admin Web App

Open another terminal and run:

```powershell
cd C:\Users\DELL\Dev\pos
npm run dev
```

Expected web URL:

```text
http://127.0.0.1:5173
```

## 6. Quick Health Checks

Build everything:

```powershell
npm run build
```

Run tests:

```powershell
npm test
```

## Common Notes

- Start the API before using the web app.
- Seeded staff login details are documented in `SEED_LOGIN_DETAILS.md`.
- Product images upload locally and are served from `/uploads/products`.
- Settings controls business defaults such as VAT, service charge, receipt footer, printer name, payment methods, and categories.
- POS Terminal uses the admin-configured VAT and service charge settings.
- If the web app cannot load data, confirm MySQL and the API server are both running.
