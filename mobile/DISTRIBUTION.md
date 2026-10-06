# Sending Ajoke POS to a shop (one licence = one Android device)

Each copy of Ajoke POS must be **activated** before use, and an activation code only works on the device it was issued for. If the APK is copied to another phone, that phone shows a different device code and needs its own licence.

## One-time setup (you, the vendor)

1. **Your signing key** is already created at `mobile/.license/private-key.json`. It's what makes activation codes.
   - **Back it up** to a private place (password manager or encrypted USB). If it is lost, you can't activate any app built with it.
   - It is git-ignored. **Never** send it to anyone or put it in the app.
   - The app only contains the matching *public* key (`src/license/publicKey.ts`), which can check codes but not create them.
2. Put your name and WhatsApp number in `src/license/config.ts`. They appear on the activation screen.
3. Build the installable APK (needs a free Expo account):
   ```bash
   cd mobile
   npm install -g eas-cli && eas login       # once
   eas build -p android --profile preview    # gives a download link to an .apk
   ```
   Keep building with the **same Expo project/account**. EAS reuses the same Android signing key, so device codes stay the same across app updates. A new signing key would give every phone a new device code.

## For each shop

1. **Send the APK**: share the EAS download link, or the `.apk` file itself, by WhatsApp, Google Drive or email. On the phone, open it and allow *Install unknown apps* for the browser or WhatsApp when Android asks.
2. **Shop opens the app**: it shows **Activate NaijaPOS** with a device code such as `K7QF-29XM-C4TB`. They tap **Share device code** and send it to you.
3. **You issue the activation code**:
   ```bash
   cd mobile
   npm run license -- issue --device "K7QF-29XM-C4TB" --name "Mama Nkechi Stores" --days 365
   # or --expires 2027-12-31, or leave both out for a licence that never expires
   ```
   The tool prints the activation code and records it in `mobile/.license/issued.csv` (licence id, shop, device, dates), which is your sales log.
4. **Send the activation code** back (copy it exactly, e.g. by WhatsApp). The shop pastes it into **Activate**, and the app opens to setup.

To check a code someone sends you: `npm run license -- verify --device "K7QF-29XM-C4TB" --code "<code>"`.

## Renewals and changes

| Situation | What to do |
|---|---|
| Licence expiring | The app warns on the sign-in screen 14 days before. Issue a new code for the **same device code** with a later expiry. On expiry the app locks, but no data is lost. |
| Shop buys a new phone, or factory-resets | The device code changes. Issue a new licence for the new code. They can move their records with *Backup → Restore*; the licence itself does not travel with a backup. |
| App reinstalled or updated on the same phone | Same device code, so the existing activation code still works (paste it again after a reinstall). |
| Phone date set back to avoid expiry | The app notices and asks for the correct date. |

## Development and testing

- **Expo Go and dev builds** show the activation screen with a *Continue without licence (development build only)* button. The installable APK never has it.
- Device codes shown in Expo Go are not the same as in the installed app (different app). Issue real licences only from codes shown by the APK.

## Limits

- **Activation is fully offline**, so a code can't be revoked remotely once issued. Expiry dates are the main control. If you later need remote revocation or per-shop dashboards, add an online activation server that checks the same signed codes.
- **A determined person could modify the APK** to skip the check, as with any offline Android licensing. Making that harder means distributing through Google Play with Play Integrity checks, or adding online activation.
- **Android ID** (the source of the device code) changes after a factory reset, and differs between apps signed with different keys (see the signing note in step 3 of the one-time setup).
