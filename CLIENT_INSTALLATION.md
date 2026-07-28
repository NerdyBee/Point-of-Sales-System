# NaijaPOS Client Installation and Testing Guide

This document explains how to install and run NaijaPOS locally on a client machine for testing and demo purposes, and summarizes the main features that are currently available.

## System Requirements

- Windows 10 or later
- Node.js 20.x or newer
- npm 10.x or newer
- MySQL server running locally (e.g. XAMPP, Laragon, MySQL service)
- Git (optional, for repository checkout)

## Repository Setup

1. Clone the repository or copy the project folder to the client computer.
2. Open a terminal in the project root, for example:

```powershell
cd C:\Users\DELL\Dev\pos
```

3. Install dependencies:

```powershell
npm install
```

## Environment Configuration

1. Ensure a `.env` file exists in the project root.
2. The app expects a MySQL database connection string. Example:

```env
DATABASE_URL="mysql://root:GrinDa@localhost:3306/naijapos"
```

3. Confirm MySQL is running and the database is reachable on `localhost:3306`.

## Database Preparation

1. Generate Prisma client code:

```powershell
npm run db:generate
```

2. Push database schema to MySQL:

```powershell
npm run db:push
```

3. Seed demo data:

```powershell
npm run db:seed
```

4. If you need to reset the database completely:

```powershell
npm run db:reset
```

## Starting the Application

### API Server

Open a terminal and run:

```powershell
npm run dev:api
```

Expected API address:

```text
http://127.0.0.1:4000
```

### Admin Web App

Open another terminal and run:

```powershell
npm run dev
```

Expected web address:

```text
http://127.0.0.1:5173
```

## Verifying the Installation

- Confirm the API server starts without errors.
- Confirm the admin web app loads in the browser.
- Log in using the seeded tenant and staff credentials if available.
- Load branch, catalog, inventory, sales, and settings pages.

## What You Can Show So Far

### Verified Working Features

- Multi-tenant admin interface
- Tenant authentication and session handling
- Branch and terminal management
- Product catalog listing, create, and update
- Product image upload and storage
- Inventory suppliers, purchase receipts, stock adjustments, and counts
- Sales creation, void, refund, and receipt actions
- Register opening, cash movements, reconciliation, and close operations
- Customer creation and ledger entries
- Staff listing, creation, updates, invite resend/revoke, and status changes
- Role management and permission assignment
- Subscription overview and invoice status updates
- Sync queue monitoring and record status management
- Tenant settings management: business profile, tax, payments, receipt footer, hardware, and product categories
- Audit logging and approvals interface
- Restaurant floor plan and kitchen display modules available in the UI

### Demo Flow Suggestions

1. Open the admin app and sign in.
2. Visit the `Settings` page to confirm tenant settings are loaded.
3. Open `Branches` and show branch creation or updates.
4. Go to `Catalog` and create or edit a product, including uploading an image.
5. Open `Inventory` and show supplier creation, purchase receipt entry, or stock adjustment.
6. Use `Sales` or the POS terminal to create a sale and queue a receipt action.
7. Visit `Registers` to open a shift, add a cash movement, and close a register.
8. Show `Customers` ledger or `Roles` and `Staff` pages to demonstrate business controls.
9. Navigate `Sync`, `Audit`, and `Approvals` modules to show admin oversight.

## Notes

- The app is currently designed for local testing and demo use.
- The product is in a functional state with key POS and admin workflows implemented, but some advanced features may still be incomplete.
- If the web app cannot load data, ensure both MySQL and the API server are running.

## Helpful Files

- `STARTUP.md` — project startup instructions
- `SYSTEM_FEATURES.md` — feature summary and development status

---

This guide is intended for client-side testing and demonstration of the current NaijaPOS implementation.
