# Seed Login Details

These accounts are created by `npm run db:seed` / `npm run db:reset`.

## Tenant

- Tenant ID: `tenant-lagos-foods`
- Business: Lagos Central Foods
- Default branch: `branch-lagos-main` / Main Branch
- Default terminal: `terminal-web-1` / Front Counter

## Password Login

Use the same seeded password for all active staff below:

```text
Password123!
```

| # | Staff ID | Name | Email | Role | Branch | PIN Enabled | PIN |
|---:|---|---|---|---|---|---|---|
| 1 | `owner-1` | Adaeze Okafor | `adaeze@example.com` | `owner` | `branch-lagos-main` | Yes | `1234` |
| 2 | `staff-1` | Chinelo Okafor | `chinelo@example.com` | `manager` | `branch-lagos-main` | Yes | `1234` |
| 3 | `staff-2` | Musa Ibrahim | `musa@example.com` | `cashier / teller` | `branch-lagos-main` | Yes | `1234` |
| 4 | `staff-3` | Sarah Johnson | `sarah@example.com` | `inventory` | `branch-lagos-main` | No | N/A |
| 5 | `staff-4` | Tunde Balogun | `tunde@example.com` | `state_manager` | `branch-lagos-main` | Yes | `1234` |

## PIN Login

For terminal PIN login, use:

- Tenant ID: `tenant-lagos-foods`
- Branch ID: `branch-lagos-main`
- Terminal ID: `terminal-web-1`
- Staff ID: one of `owner-1`, `staff-1`, `staff-2`, or `staff-4`
- PIN: `1234`

Cashier/teller quick test:

- Select `Musa Ibrahim`
- Enter PIN `1234`
- The app should open the POS/Register workflow with sales and register permissions only.

State manager quick test:

- Login with `tunde@example.com` and `Password123!`
- The app should show cross-branch modules and allow viewing all branches.

## Other Seeded Terminals

| # | Terminal ID | Name | Branch | Device Code | Status |
|---:|---|---|---|---|---|
| 1 | `terminal-web-1` | Front Counter | `branch-lagos-main` | `LAG-MAIN-01` | online |
| 2 | `terminal-web-2` | Terrace POS | `branch-lagos-main` | `LAG-MAIN-02` | offline |
| 3 | `terminal-ikeja-1` | Ikeja Counter | `branch-lagos-ikeja` | `LAG-IKEJA-01` | maintenance |

## Notes

- These are local development credentials only.
- The API stores hashed passwords/PINs; this file documents the plain seeded values for testing.
- Re-seeding resets these accounts back to the values above.
