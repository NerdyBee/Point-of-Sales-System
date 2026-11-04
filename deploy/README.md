# Delivering Ajoke POS to a client (office server + cloud)

Each client gets two installations of the same business:

- **Cloud server.** You host it on a rented Linux server. The client reaches it at their own web address from anywhere.
- **Office server.** It runs on a Windows PC in the client's shop. It works without internet, and shop PCs and tablets use it over the shop Wi-Fi. When the internet is up, it syncs with the cloud every 30 seconds (see [SYNC_ARCHITECTURE.md](../SYNC_ARCHITECTURE.md)).

The business is created once, on the cloud. The office downloads it when it connects.

## 1. Build the packages (your computer)

```powershell
npm install
npm run release
```

This produces:

| Output | What it is |
|---|---|
| `release/cloud/` | The cloud server folder: Docker setup and the built app |
| `release/AjokePOS-Office-<version>.zip` | The Windows installer you send to the client (~150 MB) |

Use `npm run release -- --cloud` or `-- --office` to build only one of them. The first office build downloads MariaDB once into `release/.cache/`.

Before each new release, raise `version` in the root `package.json`.

## 2. Set up the cloud server (once per client)

1. **Rent a server.** A small Ubuntu VPS with 2 GB RAM is enough, for example DigitalOcean, Hetzner, Contabo or AWS Lightsail. Install Docker: `curl -fsSL https://get.docker.com | sh`.
2. **Point a domain at it.** Create a DNS `A` record such as `pos.clientbusiness.com` → the server's IP address.
3. **Copy the cloud package to the server:**
   ```bash
   scp -r release/cloud root@SERVER_IP:/opt/naijapos
   ```
4. **Configure and start it** (on the server):
   ```bash
   cd /opt/naijapos
   cp .env.example .env
   nano .env          # set DOMAIN and two long random passwords
   docker compose up -d --build
   ```
   Caddy gets the HTTPS certificate automatically. Check that `https://pos.clientbusiness.com/health` responds.
5. **Create the client's business:**
   ```bash
   docker compose exec app node dist/business.cjs create \
     --name "Bella Foods" --owner "Grace Mensah" --email grace@bellafoods.com \
     --password "TempPass123!" --pin 123456 --currency GHS --tax 0.15 --city Accra
   ```
   Options: `--branch` (default `Main`), `--plan` (`Starter`, `Business`, `Professional`, `Enterprise`; default `Business`), `--phone`, `--id`. `--tax` is a fraction, so `0.15` means 15%.
6. **Create a pairing code for their office server:**
   ```bash
   docker compose exec app node dist/sync.cjs pair-office --name "Shop office"
   ```
   The code works once and expires in 24 hours. You can also create it in the web app under **Sync monitor → Pair a tablet or office**.

**Cloud backups.** Run this daily from cron and copy the file off the server:
```bash
docker compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers naijapos' | gzip > /root/naijapos-$(date +%F).sql.gz
```

## Activation (every installation)

Each installed copy, office or cloud, must be activated for the computer it runs on, so one zip can't be installed on more PCs than were paid for. It uses the same signing key and tool as the Android app (`mobile/.license/private-key.json`; keep it backed up and private).

1. **Get the device code.** An unactivated install shows an **Activate Ajoke POS** page with a code like `K7QF-29XM-C4TB`, and the office installer prints it at the end. On the cloud, run `docker compose exec app node dist/license.cjs status`.
2. **Issue the activation code** (in `mobile/`):
   ```
   npm run license -- issue --product office --device "K7QF-29XM-C4TB" --name "Bella Foods" --days 365 --branches 2 --staff 10 --terminals 4
   ```
   - `--days 365` or `--expires 2027-12-31` sets an expiry. Leave both out for no expiry.
   - `--branches`, `--staff` and `--terminals` are what the client paid for. Each one you leave out is unlimited.
   - The code is recorded in `mobile/.license/issued.csv` with an `OFF-` ID.
3. **The client pastes the code** on the activation page. On the cloud, run `docker compose exec app node dist/license.cjs activate --code "<code>"`.

How it behaves:
- **Tied to the computer.** The code is tied to Windows' machine ID, so reinstalling on the same PC keeps it but a different PC needs its own code. On the cloud, it's tied to the installation's database.
- **Expiry.** The app warns 14 days before expiry. After that it shows only the activation page until a new code is entered. No data is lost.
- **Moving the clock back** to dodge expiry is detected.
- **Upgrades.** To sell more branches, staff or terminals, issue a new code with higher limits and the client pastes it in.
- **Limits can't be changed by the client.** Installed copies ignore the database's own plan limits and use only the limits in the signed code.

Phones still need their own activation codes as before (`issue` without `--product office`).

**Limit:** this stops ordinary copying. Someone skilled enough to change the program's code could still remove the check, as with any software that runs offline.

## 3. Send the office package to the client

Send `AjokePOS-Office-<version>.zip` (Google Drive or WeTransfer link) along with:

- the cloud address, e.g. `https://pos.clientbusiness.com`
- the pairing code
- the sign-in details printed by `business.cjs create`: the **Business ID** (e.g. `tenant-bella-foods`), owner email and temporary password, plus the owner's **staff ID**, which can sign in on its own without the Business ID. Ask them to change the password under **Profile** after their first sign-in

They follow `README.txt` inside the zip: extract it, double-click **Install.cmd**, and enter the address and code when asked. The installer:

- installs MariaDB as the `AjokePOS-DB` service (port 3307, so it doesn't clash with any MySQL already on the PC), with random passwords
- creates the tables
- downloads the business from the cloud
- registers the `Ajoke POS Server` task to start with Windows on port 4000
- opens the firewall for the shop network, adds a desktop shortcut and a daily 21:00 backup into `C:\AjokePOS\backups`

## Offline-only clients (no cloud)

A client who doesn't need the cloud can install the office package alone:

1. They run **Install.cmd** and press Enter when asked for the cloud address.
2. Ajoke POS opens on a **Welcome to Ajoke POS** page. They fill in their business, currency, VAT and owner details, and it signs them in.

The page only appears while the installation has no business. It only accepts the form from the shop computer itself (`http://localhost:4000`), so another device on the network can't claim a fresh install.

Such a business exists only on that computer. If the client wants a cloud later, create their business on the cloud with the same Business ID (`--id`) before pairing, so both sides join up. To see their Business ID, run `..\node\node.exe dist\business.cjs list` in `C:\AjokePOS\server` on their PC.

## 4. Updates

1. Raise the version and run `npm run release`.
2. **Cloud:** copy `release/cloud/server` over `/opt/naijapos/server`, then run `docker compose up -d --build`.
3. **Office:** send the new zip. The client runs **Install.cmd** again and all data is kept.

Schema changes are applied with `prisma db push`. It refuses changes that would delete data. If an update needs one, handle it manually before you ship.

Update the cloud first, then the offices. An office running an older version can't apply rows for columns it doesn't have yet.

## Things to know

- **Product images** are files, and files don't sync. An image uploaded on the office shows only on the office, and the same goes for the cloud.
- **Sign-ins are per server.** Staff and passwords sync, but a session on the office doesn't sign you in on the cloud.
- **Exposure to the internet.** The cloud is public. Use strong owner passwords, and keep the cloud updated.
- **Support access.** To check a client's office server remotely, use AnyDesk or TeamViewer. Logs are in `C:\AjokePOS\logs\server.log`.
