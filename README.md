# PX POS

PostX point of sale for restaurants and cafés, on one Firebase backend (`postx-pos`):

| Part | What it is | Where it runs |
|---|---|---|
| **pos-admin** (`apps/pos-admin`) | Back office: clients, menu, staff, terminals, settings, orders, end of day | [px-pos.vercel.app](https://px-pos.vercel.app) (Next.js 16) |
| **pos-app** (`apps/pos-app`) | The till: orders, KOTs, payments, printing, cash drawer, customer display, works offline | Android POS terminals and phones (Expo dev build, APK) |
| **@px-pos/core** (`packages/core`) | Shared bill maths, receipts, numbering and write plans | Used by both apps |
| **firebase/** | Firestore rules, indexes and rules tests | Firebase project `postx-pos` |

Developer notes (stack, conventions, hardware, data rules) are in [CLAUDE.md](CLAUDE.md).

## Version

Current version: **v1.0.1** (admin and till).

- **Admin:** shown at the bottom of the sidebar ("PX POS v1.0.1"). It comes from `apps/pos-admin/package.json`.
- **Till:** shown on the sign-in screen and on Sync. Each terminal reports it to admin › Terminals (Device column). It comes from `apps/pos-app/package.json`. Android's build number follows it: 1.0.1 → 10001.

### Releasing a new version

1. Bump `version` in `apps/pos-admin/package.json` and/or `apps/pos-app/package.json`, plus the root `package.json`. Then run `npm install --package-lock-only` so the lockfile matches.
2. For the till, also update `versionCode` / `versionName` in `apps/pos-app/android/app/build.gradle`. That folder is generated and not in git; `npx expo prebuild --platform android` writes the same values.
3. Add a line under **Changes** below.
4. **Admin:** push to `main`. Vercel deploys it to production.
5. **Till:** build the release APK (below), then `adb install -r` it on each terminal. The new build number must be higher than the installed one.

## Run it

```bash
npm install                       # once, at the repo root
npm run dev:admin                 # admin on http://localhost:3000 (uses the live Firebase project)
npm test                          # core unit tests
npm run rules:test                # Firestore rules tests on the emulator (JDK 21)

# Till release APK (32-bit TVS terminals and 64-bit phones)
cd apps/pos-app/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

`apps/pos-admin/.env.local` and the app's `google-services.json` aren't in git. See CLAUDE.md › Environment for how to get them.

## Changes

### v1.0.1 (8 Oct 2026)

- **Version numbers:** the admin and the till now show their version.
- **What prints on a bill:** admin › Settings › Receipt has a "Print on the bill" list, so an outlet can leave off any line except the items, the items total and TOTAL. A shorter bill uses less paper. The till follows this from v1.0.1.
- **Safer offline sync on the till:** sales still queued after a restart are no longer sent twice. A sale marked failed is checked against the server first, and anything missing is resent oldest first.
- **TVS TP-482C printing:** prints through the built-in printer's own driver. The printer, cash drawer and customer display take turns, and the drawer opens before the bill prints.
- **Already in use before this version:** End of day on the till and in admin; receipt logo; Bluetooth printers; Restart numbering; Duplicate client.
