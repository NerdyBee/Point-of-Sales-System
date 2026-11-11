# Ajoke POS build and release guide

Every step and command for building, releasing and delivering Ajoke POS, from your development PC to a client's activated installation. Run all commands in PowerShell, from `C:\Users\DELL\Dev\pos` unless a step says otherwise.

More detail on specific areas:

| Topic | Read |
|---|---|
| Cloud server, sync and pairing | [deploy/README.md](deploy/README.md) |
| Android app builds and licences | [mobile/DISTRIBUTION.md](mobile/DISTRIBUTION.md) |
| Videos, manuals and illustrations | [scripts/marketing/README.md](scripts/marketing/README.md) |
| How office and cloud sync works | [SYNC_ARCHITECTURE.md](SYNC_ARCHITECTURE.md) |

---

## 1. One-time setup on your PC

### Software

| Tool | Used for | Check |
|---|---|---|
| Node.js 24 and npm | Everything | `node -v` |
| MySQL 8 or 9 (local) | Development database | `mysql --version` |
| Git, signed in to GitHub | Source code | `git remote -v` |
| Google Chrome or Edge | Screenshots for the manuals | |
| ffmpeg | Videos | `ffmpeg -version` |
| Python 3 with Pillow, reportlab and pymupdf | Manuals and illustrations | `python -c "import PIL, reportlab"` |
| Expo account and EAS CLI | Android app builds | `npx eas-cli@latest whoami` |

### Project

```powershell
cd C:\Users\DELL\Dev\pos
npm install                      # web app, API and shared packages
cd mobile; npm install; cd ..    # Android app (a separate project)
copy .env.example .env           # then set DATABASE_URL to your local MySQL
npm run db:generate
npm run db:push
npm run db:seed                  # demo businesses; logins are in SEED_LOGIN_DETAILS.md
```

### Keep these safe

Back them up to a password manager or an encrypted USB drive. **Never put them in git or send them to anyone.**

| File | Why it matters |
|---|---|
| `mobile/.license/private-key.json` | Signs every activation code, for phones and servers. If you lose it, you can't activate anything already sold. |
| `mobile/.license/issued.csv` | Your record of every licence sold (phone codes start `LIC-`, server codes `OFF-`). |
| EAS Android keystore (`eas credentials` → download) | Phone device codes depend on it. If it changes, every phone licence stops working. |
| Each cloud server's `.env` | Its database passwords. |

---

## 2. Everyday development

```powershell
npm run dev:api        # API on http://127.0.0.1:4000 (terminal 1)
npm run dev            # web app on http://127.0.0.1:5173 (terminal 2)
cd mobile; npm start   # Android app in Expo Go (terminal 3, optional)
```

When running from source, activation isn't required and demo data is available.

### Tests and checks (run before every release)

```powershell
npm test                                       # API and web tests
npx tsc -p server/api/tsconfig.json --noEmit   # API typecheck
npx tsc -p apps/admin-web/tsconfig.json --noEmit
cd mobile; npm test; npm run typecheck; cd ..
```

Two Android backup tests can time out when the PC is busy, for example straight after a build. Run them again before treating that as a failure.

### Database changes

Edit `database/prisma/schema.prisma`, then run `npm run db:generate` and `npm run db:push`. Installed servers apply the same change themselves when they're updated: the office installer and the cloud container run `prisma db push`, which refuses changes that would delete data.

---

## 3. Releasing a new version

1. **Raise the version**:
   - **Server and web:** `"version"` in the root `package.json`, for example `0.1.0` → `0.2.0`. It goes into the file names, such as `AjokePOS-Office-0.2.0.zip`.
   - **Android:** `expo.version` and `expo.android.versionCode` in `mobile/app.json`. `versionCode` must go up by at least 1 every time.
2. **Test** (section 2).
3. **Build the installable packages:**
   ```powershell
   npm run release                 # cloud package + Windows office installer
   ```
   - `release\cloud\` is the cloud server package (Docker).
   - `release\AjokePOS-Office-<version>.zip` is the Windows installer.
   - Use `npm run release -- --office` or `-- --cloud` to build just one.
4. **If screens changed, refresh the manuals and videos** (section 7).
5. **Build the client package** (section 4).
6. **Commit and push:**
   ```powershell
   git add -A; git commit -m "Release 0.2.0"; git tag v0.2.0
   git push origin main --tags
   ```
7. **Android app**, if it changed (section 6).

---

## 4. The client package

```powershell
npm run package:client                 # rebuilds the installer first
npm run package:client -- --skip-build # reuses the installer already built
```

The output is `release\AjokePOS-Client-Package-<version>.zip`, about 170 MB. It contains:

- `START HERE.txt`
- the Installation Guide PDF and installation video
- the installer zip
- the User Manual PDF and tour video

Send it through Google Drive, WeTransfer or Dropbox. It's too big for WhatsApp.

---

## 5. Delivering to a client

### A. Offline office server (no cloud)

1. Send the client package.
2. The client installs it and presses Enter at the cloud question. The installer and the activation page show a **device code**, for example `EAZX-MWU9-J8M6`.
3. **Issue their activation code**:
   ```powershell
   cd mobile
   npm run license -- issue --product office --device "EAZX-MWU9-J8M6" --name "Bella Foods" --days 365 --branches 2 --staff 10 --terminals 4
   cd ..
   ```
   - Leave out `--days` for a licence with no expiry, or use `--expires 2027-12-31` for a fixed date.
   - Leave out any limit to make it unlimited.
   - Copy the printed code and send it to the client on WhatsApp.
4. The client pastes the code, then creates the business on the **Welcome to Ajoke POS** page.

### B. Office server with a cloud server

Follow [deploy/README.md](deploy/README.md) section 2. In short:

```bash
# on the cloud server (Ubuntu with Docker), after copying release/cloud to /opt/naijapos
cd /opt/naijapos
cp .env.example .env && nano .env          # DOMAIN and two passwords
docker compose up -d --build
docker compose exec app node dist/license.cjs status          # the cloud's device code
docker compose exec app node dist/license.cjs activate --code "<code>"
docker compose exec app node dist/business.cjs create --name "Bella Foods" --owner "Grace Mensah" --email grace@bella.com --password "TempPass123!" --currency GHS --tax 0.15
docker compose exec app node dist/sync.cjs pair-office --name "Shop office"
```

Issue the cloud's activation code the same way as an office one (step A3, using the cloud's device code).

Send the client:
- the client package
- the cloud address
- the pairing code (valid for 24 hours)
- the **staff ID** and temporary password printed by `business.cjs create`

At the installer's cloud question, they enter the address and the pairing code. The office then downloads the business, and they activate it with their own code (step A3).

### C. Android app

For a business with several shops, the boss can use the Android app in **owner mode** to see all branches and approve requests (see [mobile/DISTRIBUTION.md](mobile/DISTRIBUTION.md) section 2). It needs the server address and the owner's staff ID and password, plus a phone activation code like any phone.

Send the APK (section 6). The phone shows a device code. Issue its activation code without `--product office`:

```powershell
cd mobile
npm run license -- issue --device "3CUN-B7EN-MAWB" --name "Mama Nkechi Stores" --days 365
```

---

## 6. Android app (APK)

```powershell
cd mobile
npx eas-cli@latest build -p android --profile preview    # installable APK, built in the cloud
```

EAS prints a download link. Raise the version in `app.json` first, as in section 3. Shops install the new APK over the old one; they must not uninstall, because uninstalling deletes the app's data. The full process is in [mobile/DISTRIBUTION.md](mobile/DISTRIBUTION.md).

---

## 7. Manuals and videos

Run these after screens change. They take about 15 minutes in total:

```powershell
npm run release -- --office                          # the app that gets filmed
python scripts/marketing/tiles.py                    # demo product pictures
npx tsx scripts/marketing/demo.ts                    # demo shop + screenshots
python scripts/marketing/manual.py                   # User Manual PDF
python scripts/marketing/video.py                    # tour video + subtitles
python scripts/marketing/install_art.py              # installer illustrations
python scripts/marketing/install_guide.py            # Installation Guide PDF
python scripts/marketing/video.py install-story.json # installation video
```

The output goes to `release\marketing\`. Text, captions, narration, and the Yoruba pronunciation of "Ajoke" are set in `scripts/marketing/` (see its README).

---

## 8. Updating existing clients

1. Release a new version (section 3) and build the client package.
2. **Cloud first:** copy the new `release/cloud/server` over `/opt/naijapos/server`, then run `docker compose up -d --build`.
3. **Office:** the client extracts the new installer and runs `Install.cmd` again. Their data and activation are kept.
4. **Android:** send the new APK. It installs over the old one.

---

## 9. Support commands

On a client's office PC, run these in PowerShell as administrator, in `C:\AjokePOS\server`:

```powershell
..\node\node.exe dist\license.cjs status                 # device code, licence, expiry
..\node\node.exe dist\license.cjs activate --code "..."  # activate from the command line
..\node\node.exe dist\business.cjs list                  # business ID(s)
..\node\node.exe dist\sync.cjs status                    # cloud link and paired tablets
..\node\node.exe dist\sync.cjs pair-device --terminal <id> --name "Tablet 1"
C:\AjokePOS\backup.ps1                                   # back up now
C:\AjokePOS\connect-cloud.ps1                            # connect to a cloud later
```

- **Logs:** `C:\AjokePOS\logs\server.log`
- **Backups:** `C:\AjokePOS\backups`, every day at 21:00, with the newest 30 kept.

On the cloud, run the same commands as `docker compose exec app node dist/<tool>.cjs ...`.

On your PC (in `mobile/`):

```powershell
npm run license -- verify --device "XXXX-XXXX-XXXX" --code "<code>"   # check a code
npm run license -- reset-pin --request "XXXX-XXXX-XXXX-XXXX-XXXX"    # phone owner forgot their PIN
npm run license -- open-backup --file <backup.json> --password <new>  # phone backup password lost
```

---

## 10. Quick reference

| I want to... | Command |
|---|---|
| Run the app while developing | `npm run dev:api` + `npm run dev` |
| Run all tests | `npm test`, and `cd mobile; npm test` |
| Build the installers | `npm run release` |
| Build what I send to a client | `npm run package:client` |
| Activate a client's PC or cloud | `cd mobile; npm run license -- issue --product office --device "..." --name "..."` |
| Activate a client's phone | `cd mobile; npm run license -- issue --device "..." --name "..."` |
| Build the Android APK | `cd mobile; npx eas-cli@latest build -p android --profile preview` |
| Create a business on the cloud | `docker compose exec app node dist/business.cjs create ...` |
| Pair an office with the cloud | `docker compose exec app node dist/sync.cjs pair-office --name "..."` |
| Refresh the manuals and videos | section 7 |
| Publish my changes | `git push origin main` |
