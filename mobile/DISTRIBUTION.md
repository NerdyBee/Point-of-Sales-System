# Distributing Ajoke POS (Android)

Ajoke POS is developed by **Ajoke Code Sphere**. You give each shop an installable Android app (APK). Every copy must be **activated**, and an activation code works on **one device only**. If the APK is copied to another phone, that phone shows a different device code and needs its own licence.

- App name: **Ajoke POS**. Android package: `com.ajokecodesphere.ajokepos` (never change this after the first release, or Android treats it as a different app).
- Commands below run from the `mobile/` folder. `eas` means `npx eas-cli@latest` if you have not installed it globally.

---

## 1. Before your first sale (once)

### 1.1 Protect your licence key
Your licence signing key is at `mobile/.license/private-key.json`. It creates activation codes.
- **Back it up** to a private place (password manager, encrypted USB). If it is lost, you can't activate any copy built with it.
- It is git-ignored. **Never** send it to anyone or put it in the app.
- The app only contains the matching *public* key (`src/license/publicKey.ts`), which can check codes but not create them.

### 1.2 Put your contact details in the app
Edit `src/license/config.ts` and set your WhatsApp number. It is shown on the activation screen so shops know where to send their device code:
```ts
export const LICENSE_VENDOR = { name: "Ajoke Code Sphere", phone: "+234 803 000 0000" };
```

### 1.3 Set up EAS Build (free Expo account)
```bash
npm install -g eas-cli      # or use npx eas-cli@latest
eas login
eas build:configure         # links this app to your Expo account (first time only)
```
If this adds an EAS project id to `app.json`, commit that change.

### 1.4 Build the APK
```bash
eas build -p android --profile preview
```
This builds in the cloud and gives you a link to download an `.apk` (the profiles are in `eas.json`; `preview` makes an installable APK).

### 1.5 Back up the Android signing key (important)
EAS creates and keeps your app's Android signing key and reuses it for every build. Device codes depend on that key, so if it ever changed, **every shop's device code would change and all licences would stop working**. Download a backup and keep it private:
```bash
eas credentials
# Android → credentials.json: Upload/Download credentials between EAS servers and your local json
#         → Download credentials from EAS to credentials.json
```
Store the downloaded keystore and `credentials.json` with your licence key backup. Never commit them. Always build from the **same Expo account and project**.

### 1.6 Test it yourself
Install the APK on your own phone, issue yourself a licence (section 3), set up a test shop, make a sale, print or send a receipt, and make a backup.

---

## 2. Sending the app to a shop

1. **Send the APK**: share the EAS download link, or the `.apk` file, by WhatsApp, Google Drive or email.
2. **Install**: on the shop's phone, open the file. Android asks to *allow installing unknown apps* from WhatsApp, the browser or Files; allow it. If Google Play Protect shows a warning for an app not from the Play Store, choose *Install anyway*.
3. **Activate**: the app opens on **Activate Ajoke POS** with a device code like `K7QF-29XM-C4TB`. The shop taps **Share device code** and sends it to you.
4. **Issue the code** (section 3) and send the activation code back by WhatsApp. Copy it exactly.
5. The shop **pastes it and taps Activate**, and setup starts.

### The shop's first day (talk them through it)
1. **Setup → This device only (no server)**: business name, currency, VAT %, optional service charge, owner's name and a 6-digit PIN.
2. **Manage → Business**: add the **company logo**, **phone number** and **address**. They print on every receipt and appear on WhatsApp receipt images.
3. **Manage → Products**: add each product with price, cost and quantity in stock. Later deliveries go in **Manage → Inflow**.
4. **Manage → Staff**: add cashiers with their own PINs.
5. **Customers with credit (optional)**: open the customer and set a credit limit.
6. **Receipt printer (optional)**: *Backup* tab → **Receipt printer**. Pair a Bluetooth printer in the phone's settings first, then pick it here and print a test page.
7. **Register → Open register** with the starting float, then **Sell**.
8. **Backup → Back up now** and save the file to Google Drive or WhatsApp. Remind them to do this regularly; the app warns after 7 days.

---

## 3. Issuing activation codes

```bash
npm run license -- issue --device "K7QF-29XM-C4TB" --name "Mama Nkechi Stores" --days 365
#   --expires 2027-12-31   instead of --days for a fixed end date
#   leave both out         for a licence that never expires
```
The tool checks that the device code is complete, prints the activation code, and records the sale in `mobile/.license/issued.csv` (licence id, shop, device, issued, expires). Back this file up with your key.

To check a code someone sends you:
```bash
npm run license -- verify --device "K7QF-29XM-C4TB" --code "<activation code>"
```

---

## 4. Releasing an update

1. Raise the version in `app.json`:
   - `expo.version`, e.g. `1.0.0` → `1.0.1` (shown in the app as "Ajoke POS v1.0.1").
   - `expo.android.versionCode`, e.g. `1` → `2`. **Must go up by at least 1 every build**, or Android refuses to install it over the old version.
2. Build again: `eas build -p android --profile preview`.
3. Send the new APK to shops. Installing it **over** the existing app keeps all their data and their activation. They must **not** uninstall first, because uninstalling deletes the app's data, so make a backup before any reinstall.

Updates only install over the old app if they're signed with the same key (section 1.5).

---

## 5. Renewals and changes

| Situation | What to do |
|---|---|
| Licence expiring | The app warns on the sign-in screen 14 days before. Issue a new code for the **same device code** with a later expiry. On expiry the app locks, but no data is lost. |
| Shop gets a new phone, or factory-resets | The device code changes. Issue a new licence for the new code, then they move their records with **Backup → Restore** (on the setup screen: *Restore from a backup file instead*). The licence does not travel with a backup. |
| App updated on the same phone | Nothing to do. Data and activation stay. |
| App uninstalled and reinstalled | Same device code: paste the existing activation code again, then restore their latest backup. |
| Phone date set back to dodge expiry | The app notices and asks for the correct date. |
| Owner forgot their PIN | See **5.1** below. Another owner on the phone can also simply set a new PIN in *Manage → Staff*. |
| A second phone in the same shop | Each phone needs its own licence (its own device code). Standalone phones do not share data; for several tills sharing one stock, set up the office/cloud server instead. |

### 5.1 Resetting a forgotten owner PIN

Staff PINs are reset by an owner in *Manage → Staff*. If the **only** owner forgets their PIN, they get a one-time reset code from you:

1. On the sign-in screen they tap their name, then **Forgot PIN?**. The phone shows a **request code** like `3CUN-B7EN-MAWB-7KQ2-X9TD` (device code + a one-time part). They tap *Share request code* and send it to you.
2. **Check who is asking.** The command below shows who that device is licensed to (from `issued.csv`). Confirm it is the shop's owner (e.g. call the number you have on file) before sending anything: a reset code lets whoever holds the phone take over the owner account.
3. Run:

   ```powershell
   npm run license -- reset-pin --request "3CUN-B7EN-MAWB-7KQ2-X9TD"
   ```

4. Send them the reset code it prints. They paste it, tap *Continue*, choose a new 6-digit PIN twice, and are signed in. Nothing else on the phone changes.

A reset code works **once**, only on that phone, and only for the request shown at that moment, within 7 days. Each reset is logged in `mobile/.license/pin-resets.csv`, and the owner's record in *Manage → Staff* shows when the PIN was last reset with a code. Advise every shop to add a trusted second owner so they rarely need this.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| *App not installed* / blocked | Allow installing unknown apps for the app used to open the APK. If an older Ajoke POS is installed, the new APK needs a higher `versionCode` and the same signing key. |
| *This code is for device …, not this device* | The code was issued for another phone's device code. Ask for the code shown on **this** phone and issue a new one. |
| *Not genuine or was changed* | The code was cut off or altered when copied. Send it again in one piece. |
| Reset code: *for an older request* | They tapped *Back* and chose a different owner, or the request is over 7 days old, so the phone now shows a new request code. Ask for the code shown now and run `reset-pin` again. |
| Printing not available | Bluetooth printing works only in the installed APK, not in Expo Go. On Android 12+, allow the *Nearby devices* permission when asked. |
| Printer not in the list | Pair it in the phone's **Bluetooth settings** first (PIN is often `0000` or `1234`), or use *Bluetooth LE (scan)*. |
| Logo prints too dark or blotchy | Use a simple, high-contrast logo (dark on white or transparent). Printers print black dots only. |
| WhatsApp is not in the share menu | Make sure WhatsApp is installed. **Send (WhatsApp)** shares the receipt as an image; choose WhatsApp, then the chat. |

---

## 7. Development and testing

- `npm start` opens the app in **Expo Go** (scan the QR code). Bluetooth printing isn't available there; everything else works.
- `eas build -p android --profile development` makes a development build that includes Bluetooth. Run it with `npm run start:dev`.
- Expo Go and development builds show *Continue without licence (development build only)* on the activation screen. The installable APK never does.
- Device codes in Expo Go differ from the installed app's. Issue real licences only for codes shown by the APK.
- Expo Go shows its own loading screen. Your Ajoke icon and splash appear in the installed APK.

---

## 8. Limits

- **Activation is fully offline**, so an issued code can't be revoked remotely. Expiry dates are the main control. If you later need remote revocation or a dashboard of active shops, add an online activation server that checks the same signed codes.
- **A determined person could modify the APK** to skip the licence check, as with any offline Android licensing. Distributing through Google Play (`eas build -p android --profile production` makes the Play Store bundle) with Play Integrity checks, or online activation, makes that harder.
- **The device code comes from the Android ID**, which changes after a factory reset and depends on the app's signing key (section 1.5).
- **Standalone data lives only on the phone** until it is backed up. Encourage shops to back up often.
