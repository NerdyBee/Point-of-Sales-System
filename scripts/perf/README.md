# Load test: does Ajoke POS stay fast as a shop's history grows?

Two tools, for a **test database only**:

| Tool | What it does |
|---|---|
| `seed.mts` | Adds a long trading history: sales, payments, register shifts and audit events. It copies a real sale so the rows are realistic. |
| `measure.mts` | Times the screens that grow with history (dashboard, sales list, receipt search, audit log, and others), and prints the median time and size of each. |

## Running it

1. **Set up a test business.** Start a MariaDB or MySQL test database and the API against it. Create a business on the setup page and make one sale.
2. **Add history:**
   ```powershell
   $env:DATABASE_URL = "mysql://pos:pospw@127.0.0.1:3393/perf"
   npx tsx scripts/perf/seed.mts --sales 100000 --days 365                    # the last year
   npx tsx scripts/perf/seed.mts --sales 900000 --days 1825 --older-than 365  # five earlier years
   ```
3. **Time the screens:**
   ```powershell
   npx tsx scripts/perf/measure.mts --url http://127.0.0.1:4500 --staff <staff ID> --password "<password>"
   ```

## Results (November 2026, two branches, Windows laptop)

| Screen | Before the fix, 100,000 sales | After the fix, **1,000,000 sales** |
|---|---|---|
| Dashboard, Today | 12.5 s | 0.02 s |
| Dashboard, This month | 13.1 s | 0.08 s |
| Dashboard, This year (86,000 sales in the year) | 14.3 s | 2.6 s |
| Sales list (last 30 days) | failed after 48 s | 0.23 s |
| Sales list, one day | n/a | 0.02 s |
| Receipt search across all history | n/a | 0.01 s |
| Audit log, approvals, expenses, customers, stock, register | under 0.2 s | under 0.02 s |

What changed:
- **Reports read only the chosen period**, through date indexes, and don't load receipts. Payment totals and the audit count are added up by the database.
- **The sales list** shows a date range (default: the last 30 days), with a cap of 2,000 and a note when the cap is reached. Receipt search matches from the start of the receipt number. Customers and payments are fetched in one query each, instead of two queries per sale.
- **Approvals and expenses** return the newest 1,000.
- **The database memory cache** is set to 512 MB on office installs and the cloud.

The old and new reports were run side by side on the same 100,000 sales and gave identical figures for every period and branch.

The year view grows with how busy **that year** was, not with how many years are stored. Every other screen takes the same time whatever the size of the history.
