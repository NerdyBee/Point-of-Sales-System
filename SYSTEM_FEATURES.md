# NaijaPOS System Feature Summary

## Overview

NaijaPOS is a multi-tenant point-of-sale platform with an admin web frontend in `apps/admin-web` and a backend API server in `server/api`. It uses Prisma with MySQL and supports tenant-aware operations, access control, audit logging, and sync queue management.

## Implemented Features

### Core architecture
- Multi-tenant authentication with password login, PIN login, refresh token, and session management
- Tenant bootstrap endpoint for branch and staff selection
- Tenant settings persisted as JSON and used throughout the system
- Authorization middleware: `requireTenant`, `requireAuthenticatedUser`, `requirePermission`
- Static asset serving for uploaded product images from `/uploads/products`

### Branches and terminals
- Branch listing and branch options
- Create and update branches with branch status and default-branch rules
- Create and update terminals with device code uniqueness and online/offline validation
- Branch limits enforced by tenant plan

### Product catalog
- List catalog products with branch-scoped filtering
- Upload and store product images in PNG/JPG/WEBP/GIF formats
- Create and update products with SKU/barcode uniqueness checks
- Category restrictions enforced by tenant settings
- Default tax rate applied from tenant settings when product tax rate is omitted

### Inventory
- View current stock and inventory movements
- Manage suppliers and supplier product relationships
- Receive purchase receipts and update stock balances
- Post stock adjustments with negative stock prevention
- Post stock counts with variance tracking
- Inventory audit logging

### Sales and POS
- List sales by branch and status
- Create sales with validation for open register, terminal status, branch status, payment settings, customer credit, and stock availability
- Queue receipt actions for print/WhatsApp delivery
- Void completed sales
- Refund sales with amount validation
- Use tenant payment settings to enable/disable cash/card/bank transfer/mobile money
- Sales terminal UI integrated into admin app

### Registers and cash management
- Get current open register/shift
- Open register shift with terminal branch/online validation
- Create cash movements and keep expected cash non-negative
- Reconcile payment records
- Close register shift with pending payment guards

### Customers and ledger
- List and search customers
- Create and update customer records
- Customer ledger entries for credit/points adjustments
- Credit limit and negative points validation

### Staff and permissions
- List staff for branch or tenant
- Create and update staff members
- Change staff status (active/inactive)
- Resend and revoke staff invites
- Role management with permissions catalog
- Assign staff roles

### Reporting and audit
- Dashboard and reports UI modules present
- Audit log UI module present
- Audit events recorded for major actions
- Approvals module present for review workflows

### Restaurant and kitchen
- Restaurant floor plan UI with table ordering and checkout integration
- Kitchen display UI for prep ticket routing
- Restaurant backend route support exists for table orders and reservations (module present)

### Subscriptions and billing
- Current subscription overview endpoint
- Update tenant subscription settings
- Update subscription invoice statuses

### Sync and offline support
- Sync queue listing endpoint
- Queue sync records from terminals or other sources
- Update sync record status via admin UI

### Tenant settings
- Tenant profile settings: business name, tax ID, default branch, currency
- Service settings: tax rate, service charge enable/rate, receipt footer, WhatsApp receipts
- Payment methods configuration
- Hardware flags: printer, cash drawer, barcode scanner
- Product category CRUD and rename support with category usage enforcement

## What is Done

- Full admin web navigation covering dashboard, POS terminal, sales, catalog, inventory, expenses, branches, registers, floor, kitchen, customers, staff, roles, security, subscriptions, sync, approvals, audit, settings
- Solid backend route coverage for core modules
- Tenant settings integrated into catalog, sales, register, and UI behavior
- Product image storage and upload working
- Role and permission enforcement for protected actions
- Demo/test data and feature support in reports contexts
- Existing startup instructions and database commands available in `STARTUP.md`

## What's Left / Partial Coverage

### Areas that appear partial or could be missing
- Reports may still rely on demo/test data or simplified logic rather than full production-grade analytics
- Sync queue is implemented, but offline-first conflict resolution and full terminal sync reconciliation are likely incomplete
- No visible dedicated endpoint for settings under a `settings` module (tenant settings are handled via `tenants/current/settings`)
- Product management appears basic: no variants, bundles, discounts, promotions, or advanced pricing rules
- Customer loyalty is limited to ledger entries; no explicit loyalty program or points redemption flows beyond simple credit/points adjustments
- Kitchen/restaurant features are present in UI but may not have complete end-to-end order state flows across all restaurant scenarios
- Subscriptions are supported but appear limited to current overview and invoice status updates, without billing automation or plan upgrade/downgrade flows
- Staff invites and status management are present, but there is no explicit password reset or multi-factor auth flow
- Security module appears mostly auth-related; no explicit audit of login events, IP blocking, or user lockout

### Placeholders and weak spots
- No explicit `TODO`/`FIXME` areas found in source code, suggesting no obvious stubs
- UI placeholder text exists in many forms, but this is UX helper text rather than missing functionality
- Some backend endpoints and UI modules appear to be implemented with simple behavior rather than full production edge-case handling
- The `reports` module uses `demoStore` in tests, indicating some routes may still have mock or sample-data behavior

## Suggested Improvements

### Product and sales enhancements
- Add product variants, bundles/composite products, and promotional pricing
- Add time-based pricing, discounts, and loyalty rewards redemption
- Add email receipt delivery and better receipt template customization

### Inventory and supplier improvements
- Support purchase order creation, approval, and supplier order tracking
- Add reorder automation and low-stock alerts
- Add batch/lot tracking and expiry date support

### Retail and restaurant UX
- Build a dedicated POS terminal app or responsive mobile-first POS interface
- Add table order transfer, reservation management, and split bill enhancements
- Add kitchen ticket prioritization and cook station support

### Compliance, security, and scaling
- Add OpenAPI/Swagger documentation for API discovery
- Add rate limiting, stronger session security, and MFA options
- Add monitoring, error reporting, and metrics
- Add more granular role-permission management, branch-level roles, and zone restrictions

### Testing and docs
- Add integration tests for route/repository flows and end-to-end business scenarios
- Add user-facing product documentation or admin operation guides
- Add architecture docs for tenant contexts, sync, and audit flows

### Data and analytics
- Add more production-quality reporting filters, export options, and KPI dashboards
- Add inventory forecasting, sales heat maps, and customer analytics
- Add financial reports for profit/loss, tax summaries, and cash reconciliation

## Recommended Next Document Location
- `SYSTEM_FEATURES.md` in the repo root

---

This summary is based on the current workspace source structure and route/module inspection in `apps/admin-web` and `server/api`.
