# PX POS

PostX point of sale for restaurants and cafés, on one Firebase backend (`postx-pos`):

| Part | What it is | Where it runs |
|---|---|---|
| **pos-admin** (`apps/pos-admin`) | Back office: clients, menu, staff, terminals, settings, orders, vendors, end of day | [px-pos.vercel.app](https://px-pos.vercel.app) (Next.js 16) |
| **pos-app** (`apps/pos-app`) | The till: orders, KOTs, payments, printing, cash drawer, customer display, works offline | Android POS terminals and phones (Expo dev build, APK) |
| **@px-pos/core** (`packages/core`) | Shared bill maths, receipts, numbering and write plans | Used by both apps |
| **firebase/** | Firestore rules, indexes and rules tests | Firebase project `postx-pos` |

Developer notes (stack, conventions, hardware, data rules) are in [CLAUDE.md](CLAUDE.md).

## Version

Current version: **till v1.0.2**, **admin v1.1.0**.

- **Admin:** shown at the bottom of the sidebar ("PX POS v1.1.0"). It comes from `apps/pos-admin/package.json`.
- **Till:** shown on the sign-in screen and on Sync. Each terminal reports it to admin › Terminals (Device column). It comes from `apps/pos-app/package.json`. Android's build number follows it: 1.0.2 → 10002.

### Releasing a new version

1. Bump `version` in `apps/pos-admin/package.json` and/or `apps/pos-app/package.json`, plus the root `package.json`. Then run `npm install --package-lock-only` so the lockfile matches.
2. For the till, run `npx expo prebuild --platform android` in `apps/pos-app`. It writes the new version into the generated `android/` folder (not in git).
3. Add a line under **Changes** below.
4. **Admin:** push to `main`. Vercel deploys it to production.
5. **Till:** build the Play bundle (below) and upload it in Play Console (PX POS → Test and release). The build number must be higher than the last upload.

## Run it

```bash
npm install                       # once, at the repo root
npm run dev:admin                 # admin on http://localhost:3000 (uses the live Firebase project)
npm test                          # core unit tests
npm run rules:test                # Firestore rules tests on the emulator (JDK 21)

# Till for Google Play (32-bit TVS terminals and 64-bit phones) → android/app/build/outputs/bundle/release/app-release.aab
cd apps/pos-app/android && ./gradlew :app:bundleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a

# Till APK for a cable install (assembleRelease instead of bundleRelease), then
adb install -r app/build/outputs/apk/release/app-release.apk
```

Release builds are signed with the PX POS **upload key**: `apps/pos-app/credentials/pxpos-upload.jks` (git ignores it) and `PXPOS_UPLOAD_PASSWORD` in `~/.gradle/gradle.properties`. The `plugins/with-release-signing.js` config plugin wires that in. Without them the build falls back to the test key, which Play refuses. A Play-installed till can only be updated through Play: Google signs it with its own key, so a cable APK can't replace it.

`apps/pos-admin/.env.local` and the app's `google-services.json` aren't in git. See CLAUDE.md › Environment for how to get them.

## Changes

### Admin v1.1.0 (16 Oct 2026)

- **Vendors** (Money › Vendors): who supplies the outlet, what was bought, and what is still owed.
  - **Vendors page:** what's owed in total, who to pay first (red once a bill is past the vendor's credit days), what was bought from each vendor in the last 30 days, and every vendor's balance. A vendor's details show its bills (Paid / Part paid / Due), a running statement and the last price paid for each material.
  - **Record purchase:** the vendor, bill date and number, then one line per material (quantity × rate = amount). GST is worked out per line, or added on top for bills that print it separately. A bill can be paid on delivery, in full or in part.
  - **Pay vendor:** a payment always settles the oldest bills first. The dialog shows which bills it clears, and warns before paying more than is owed (the extra is kept as an advance).
  - **Purchases** and **Payments** pages: every bill in a date range, or the totals per material with their price changes, and every payment with what it cleared. A mistake is voided with a reason; a bill's number and note can be edited.
  - A new vendor can start with what was already owed to them, or an advance they hold.
  - **End of day** shows Bought for each day, and the X report lists the day's vendor lines and drawers.
- **Before it works in production:** the Firestore rules and indexes must be deployed (`npm run rules:deploy`). The till gets its own Vendors tab in v1.1.0.

### Till v1.0.2 (12 Oct 2026)

- **First Google Play build** for production (build 10002), signed with the PX POS upload key. No visible changes from 1.0.1.

### v1.0.1 (8 Oct 2026)

- **Version numbers:** the admin and the till now show their version.
- **What prints on a bill:** admin › Settings › Receipt has a "Print on the bill" list, so an outlet can leave off any line except the items, the items total and TOTAL. A shorter bill uses less paper. The till follows this from v1.0.1.
- **Safer offline sync on the till:** sales still queued after a restart are no longer sent twice. A sale marked failed is checked against the server first, and anything missing is resent oldest first.
- **TVS TP-482C printing:** prints through the built-in printer's own driver. The printer, cash drawer and customer display take turns, and the drawer opens before the bill prints.
- **Already in use before this version:** End of day on the till and in admin; receipt logo; Bluetooth printers; Restart numbering; Duplicate client.
