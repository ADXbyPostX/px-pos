# CLAUDE.md — px-pos (PostX POS)

> Scaffolded 2026-09-29 (plan: `~/.claude/plans/alright-lets-talk-about-abstract-scott.md`).
> PostX point of sale: **pos-admin** (web back office) + **pos-app** (tablet-first till) on one Firebase backend.

## Stack

| Folder | What | Stack |
|---|---|---|
| `apps/pos-admin` | Back office for super admin (Mandy) + admins | Next.js 16.3.6 App Router (`src/`), React 19.2.3, Tailwind v4, shadcn/ui `radix-nova` (zinc), `cn`, lucide-react, Recharts via shadcn chart, sonner, date-fns 4, Firebase JS SDK 12.19 (client, live listeners) |
| `apps/pos-app` | Till / KDS for client owners + employees | Expo SDK 57 **dev build** (RN 0.86.3, React 19.2.3), expo-router (`src/app`), `@react-native-firebase` 26.4 (app/auth/firestore), NativeWind 4.2.7 + Tailwind 3.4.19 (RN Reusables pattern), expo-sqlite, react-native-tcp-socket + receipt-printer-encoder |
| `packages/core` | `@px-pos/core` — pure TS domain logic shared by both apps | Zero deps, no Firebase imports, vitest |
| `firebase/` | Rules, indexes, rules tests | firebase-tools 15.29 via `npx -y firebase-tools@15.29.0` |

- npm workspaces (one root `package-lock.json`). **React is exactly 19.2.3 everywhere** (root `overrides`). Expo SDK 57's renderer is built for it; a second React copy breaks hooks in the app.
- `npx expo install <pkg>` (from `apps/pos-app`) for anything native; plain `npm i -w pos-admin <pkg>` for admin.
- The Next app has its own `AGENTS.md` (Next 16 is not the Next.js you know — read `node_modules/next/dist/docs/` first). The Expo app's `AGENTS.md` says the same for Expo (fetch versioned docs, never trust memory).

## Roles (who uses what)

- **Super admin** (Mandy) — god mode over every client. pos-admin only.
- **Admin** — sees/manages only clients whose `adminUids` contains them. Signs in to pos-admin with email/password, and on their clients' tills with a PIN.
- **Client owner** and **employees** (manager / cashier / captain / kitchen) — pos-app only.
- **Till sign-in = name + 4–6 digit PIN** (`packages/core/src/pin.ts`). Admins set staff PINs on the Staff page; the super admin sets each admin's PIN on the Admins page. Stored only as `pinHash` (`pbkdf2-sha256$iter$len$salt$hash`: WebCrypto in admin `src/lib/pin.ts`, native `PinHash.kt` in the app) and checked on the terminal, so it works offline. An admin reaches the tills through a mirrored staff entry `staff/adm_{uid}` (role owner, `adminUid`, labelled Admin), kept in step by `assignAdminsPlan` / `adminTillPlan` and only created once they have a PIN. No PIN = can't sign in. Five wrong tries lock that name for 30 s.
- **Only the super admin pairs devices** (Mandy, 2026-10-05): sees "Waiting to pair", pairs, rejects. Rules enforce it (`pairingRequests` read/update, `terminals`/`members` create = `isSuper()`). Admins can rename, change settings/mode and revoke a paired terminal, but never re-enable a member, un-revoke or change a terminal's identity/numbering.
- **No Firebase sign-in on terminals.** Anonymous Firebase Auth everywhere; access comes from Firestore docs (`platformUsers/{uid}`, `clients/{c}/members/{uid}`). Terminals pair by on-screen code. Super admin is claimed once at `/setup` and linked to email/password (same uid).
- Phase 2 adds login without migrating data: admin email login + invites with the **same** uid as the existing `platformUsers` doc; in the app, owner/staff authenticate *inside* the app (PIN / signed grant). **A terminal's Firebase uid never changes** — its offline write queue is keyed to it.

## Brand

- Dark only, pure black `#000` + signature red `#fc0303` (logo SVGs use `#fe0101` — keep as supplied).
- Assets live in each app (moved there from the repo root on 2026-09-29):
  - `apps/pos-admin/public/brand/{favicon,postxpos,pxpos}/`
  - `apps/pos-app/assets/brand/{favicon,postxpos,pxpos}/` (RN bundles only `require()`d images; Expo `public/` is web-only)
- Usage: **favicon/** (PX mark) → browser chrome, app icons, collapsed sidebar, 404. **postxpos** (main wordmark) → `/setup`, app pairing. **pxpos** (short wordmark) → every splash/loading screen (admin loading, app native splash + boot screen — Mandy, 2026-10-05), expanded sidebar, app rail/lock, PDFs/receipts (`-black` on paper). The app's native splash is rendered by `npm run icons` and needs `npx expo prebuild --platform android` before a build.
- One registry per app: `apps/pos-admin/src/lib/brand.ts`, `apps/pos-app/src/lib/brand.ts`. A logo swap touches only these + the files.
- App launcher icons are rendered at 1024 by `npm run icons` (Inkscape) from the SVGs.

## Conventions — pos-admin UI (px-ops rules, Mandy 2026-09-04)

- Mirrors `/Volumes/PostXMaster/Developer/px-ops` shell exactly (sidebar/header/brand pattern).
- **Flat surfaces only**: no shadows, glass, blur or glows. `globals.css` zeroes every `shadow-*`. Strip `backdrop-blur` and `shadow-*` from every shadcn component you add. Background layer only: `.bg-ember` (Mandy, 2026-09-29, replaced the px-ops dot grid): one `<div aria-hidden className="bg-ember" />` in the app shell, `/setup` and 404. It gives two faint brand-red glows drifting on 76/92 s loops over pure black, with a static crown and black film grain. It animates transform/opacity only and stays static under reduced motion.
- **No subtitles, helper text or visible page titles.** `PageHeader` renders an sr-only h1; toolbars, filters and primary buttons are portalled into the top bar (`#header-actions`).
- **One full-width container**, `p-4 md:p-6`. **Never** a centred max-width container. Use the space: stats strips, grids, dense tables, side sheets.
- **The page never scrolls; only the content pane does.** Table heads and Panel titles are sticky at `-top-4 md:-top-6`. Cards use `overflow-clip`, never `overflow-hidden`.
- **Tables never clip.** `ui/table.tsx` measures itself: while it fits it clips on lg+ (keeps the sticky head); wider than its card it switches to horizontal scroll. Still size layouts so tables fit — e.g. a table beside a panel gets the bigger share (`3fr`/`2fr`) — and pull ghost buttons in cells back (`-ml-2.5`) so they line up with the column header.
- Add components only with `npx shadcn@latest add <name>` (from `apps/pos-admin`), then `grep -rn "shadow-\|backdrop-blur" src/components/ui` must be empty. Never re-add a component px-ops already customised (toggle-group, input-group, table, sidebar …); answer **no** to overwrites.
- Status colours: white / zinc / brand red, plus blue (`--qc`), green (`--success`), yellow (`--warning`) each for one purpose.
- Every async surface: loading (skeleton) + empty + error (Panel with Retry). Every route has `loading.tsx` + `error.tsx`; root has `not-found.tsx` + `global-error.tsx`. `Loadable` wraps every live listener.
- Forms: `useState` + manual validation (validators from `@px-pos/core`), `FormDialog` (Dialog desktop / bottom Sheet mobile). No react-hook-form/zod. No raw `<select>`, `alert()`, `confirm()`.

## Conventions — pos-app UI

- Tablet rail + phone bottom tabs come from one hook (`useTillNav`); phones get full-screen ticket/pay views, never side panels.
- NativeWind gotchas: put `active:` classes **on the Pressable itself**, never on a child View (NativeWind attaches touch handlers to it and the tap never reaches the Pressable). Horizontal `ScrollView`s need `grow-0` or they stretch vertically.
- **Menu layout per terminal** (admin › Terminals › ⋯ › Settings → `terminal.catalog`, missing = `"top"`, reaches the till live): `top` = category chips across the top; `side` = a category list down the left (`CategoryRail width`: ~30% of a phone screen, clamped 112–184 dp; 184 on tablets). Never hard-code columns: `ItemGrid` fits them to its measured width (`minTile`), so any screen works — the TVS gets 3 across on top, 2 beside the list.
- **Kitchen switch** (admin › Order modes → Kitchen, `client.kitchen`, missing = on; `kitchenOn` / `printsKots`): off hides the Kitchen tab and screen, stops KOT tickets, and relabels "Send KOT" as "Save order". KOT docs are still written (stock, reports) but born `served`.
- **Hold (park) orders** (`src/local/held.ts`): unsent quick/delivery tickets are SQLite drafts with a `held` marker — terminal-only, offline, never written to Firestore until paid/sent. A ticket left unfinished on screen change is listed too ("not finished"). The held name becomes `customer.name` and prints as "Token 3 - Ravi". Dine-in doesn't hold (the table is the hold).
- Drive the device by accessibility label (`uiautomator dump` + `input tap`), not pixel guesses — every Pressable needs an `accessibilityLabel`.
- **Payments** (`pay-panel.tsx`): Cash, UPI, Card and Other are recorded tenders; there's no payment gateway. UPI shows an NPCI `upi://pay` QR with the amount (on screen, and on the customer display when the compact link fits a version-3 QR) once admin › Settings › Payments has the outlet's UPI ID (`client.upi`); the cashier confirms the money arrived (soundbox/app), then completes. Card is charged on the bank's separate card machine. Complete settles with the amount on screen; Split takes part now and the rest another way. The panel never scrolls: the keypad (`Keypad fill`) takes the free height, and phones hide the tab bar while paying.
- **Terminal hardware** (`modules/pos-hardware`, Kotlin; tested on the TVS TP-482C = Aclas AOBX board, USB `6778:0112`). Sync screen → Hardware has a check for each:
  - Printer: USB printer-class interface 0, raw ESC/POS (`printUsb`). (The TVS unit's paper sensor is faulty; it prints on a Bluetooth printer instead.)
  - Bluetooth printer (`BluetoothPrinter.kt`): classic SPP/RFCOMM, raw ESC/POS in paced 512-byte chunks, link kept open 8 s after a job. Paired in Android settings, then chosen per machine on Sync › Hardware ("Use this printer", 58/80 mm) and stored in SQLite (`pref:btPrinter`, never synced). `route()` in `src/print/print.ts` picks Bluetooth → LAN (`terminal.printers`) → built-in USB. Android 12+ asks for Nearby devices (BLUETOOTH_CONNECT).
  - Customer display (132×65 dot-matrix): HID interface 1 (`/dev/hidraw0`; SELinux is permissive on this build). Frames `20 00 1F len | 0A cmd data | ~xor 03` as HID output reports 0x50–0x58 by size; images are `GS v 0` rasters, 13 rows per frame, each acked. `src/hardware/customer-display.ts` decides what it shows (welcome → last item + total → please pay → thank you).
  - Cash drawer: Aclas pulse `1B 71 00 3C FF` + `1B 43 00 00 00` through the printer pipe, sent without a paper check. Opens on any cash tender; a manual open is recorded as a `no_sale` cash movement.

## Conventions — data (both apps)

- **Deviation from px-ops (deliberate):** admin uses the **client Firebase SDK with live `onSnapshot`** (pXclusive pattern), not server actions + Admin SDK. Terminals write Firestore directly while offline, so **Firestore rules are the security boundary** for both apps. No Admin SDK anywhere in phase 1.
- **Money is integer paise** (`Paise`), rates are basis points (`Bps`, 500 = 5%). Never floats. Format only with `formatINR` from core (hand-written en-IN grouping, no `Intl` — Hermes-safe).
- **Menu prices always include GST** (Mandy, 2026-10-05; there's no "+ GST" setting). `computeBill` backs the tax out per rate bucket: CGST = SGST = round(amount × rate / 2(1 + rate)), taxable = the rest, so a ₹25 tea is 23.80 + 0.60 + 0.60 = 25.00 with no round-off. Only the opt-in service charge gets GST on top. Old bills may still say `priceMode: "exclusive"`; client docs may carry a stale `priceMode`/`requirePin` — ignored.
- **Item photos** live in `itemPhotos/{itemId}` (not on the item): a 400 px square JPEG as base64, ≤ 200 KB, made in the browser (`apps/pos-admin/src/lib/photo.ts`). Inline data works on Spark (no Storage bucket) and reaches terminals through the offline cache. The `data` field is index-exempt, audit entries never carry it, and removing a photo sets `active:false`. Bulk upload matches file names to dish names (`matchPhotoFiles`).
- **Receipt logo** (admin › Settings › Receipt, `client.receipt.logo`): the dropped PNG is turned into the printer's dots in the browser (`src/lib/receipt-logo.ts`: trim, scale to Small/Medium/Large ≤ 384×200 dots, Otsu split or dither, Invert for white/transparent logos) and stored as a packed 1-bit raster `{w, h, data}` (w a multiple of 8, base64) — a few KB on the client doc, index-exempt, audit keeps only its size. `renderInvoice` puts it first as an `image` line (bills only, never KOT/Z); the app's `encodeReceipt` sends it as centred `GS v 0` bands *between* encoder runs (the encoder pads centred text inside its line buffer, so raw bytes can't go through it).
- **Every item stores its own GST rate** (`taxBps`, required by `validateItem`), picked when it's created — never "outlet default". Slabs are GST 2.0 (`TAX_RATES`: 0/5/18/40%). `null` survives only on legacy items (billed at the outlet default, flagged `*` in admin).
- **Time**: IST fixed +330 min, no `Intl`. Sales are stamped with the terminal's open business day (`days/{bizDate}`), not the device clock. Invoice date/FY = IST calendar date at issue.
- **Every multi-doc change is a `WritePlan`** built by `@px-pos/core` plans and applied as one batch (`apply-plan.ts` in each app). UI never awaits a sale write (offline-first). Only pairing and Z close use `runTransaction` (online only).
- **Exactly-once aggregates**: any batch that increments `dailyStats` or `stock` contains exactly **one** `postings/{key}` create and sets `lastPostingKey:key`; rules reject replays atomically.
- **Offline numbering** (app): SQLite counters (keys scoped by terminal doc id — a re-paired device starts fresh) + journal via `allocateAndJournal(actionKey, …)` — idempotent per action (double taps can't burn an invoice number). Invoice no `DC1/26-27/000123` (≤16 chars), series = client prefix + terminal code; terminal codes are never reused.
- **Never hard-delete.** `active:false` or a `status` (`cancelled`/`void`). Rules deny delete everywhere.
- Common fields: `schemaVersion`, `createdAtMs` (device), `createdAt` (serverTimestamp), `updatedAtMs`, `source`, `terminalId?`, `staffId?`, `outletId:'main'` on transactional docs.
- Collection names/paths live in `@px-pos/core` (`paths.ts`) — never hand-type a path.
- Known phase-1 rule gaps (by design, closed in phase 2): unsettled orders are loosely writable by members; per-role limits are UI + audit only; till PINs are not a security boundary (a 4–6 digit hash can be guessed offline by anyone who can read the staff docs).

## Commands

```bash
npm install                       # root only (workspaces)
npm run dev:admin                 # pos-admin on :3000
npm test                          # @px-pos/core unit tests
npm run rules:test                # rules tests on the Firestore emulator (JDK 21, see Environment)
npm run rules:deploy              # deploy rules + indexes to postx-pos (adxbypostx account) — Mandy runs this herself
npm run icons                     # render app icons (Inkscape)
cd apps/pos-app && npx expo run:android   # dev build on emulator/device (JDK 17)
# Release APK (universal: TVS is 32-bit, phones 64-bit). Gradle doesn't watch packages/core, so after a
# core-only change delete apps/pos-app/android/app/build/generated/assets/react first or the JS bundle is stale.
cd apps/pos-app/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
cd apps/pos-app && npx expo-doctor
```

## Environment

- Firebase project **`postx-pos`** (Firestore `(default)`, asia-south1, Spark). Owner account `adxbypostx@gmail.com`. The machine's *active* firebase-tools account is `thinktaxbackend@gmail.com` — **always pass `--account adxbypostx@gmail.com`**.
- `apps/pos-admin/.env.local` — `NEXT_PUBLIC_FIREBASE_*` (+ `NEXT_PUBLIC_DEV_PERSONAS=1` in dev). `apps/pos-app/google-services.json` + `GoogleService-Info.plist` — gitignored, fetch with `apps:sdkconfig`.
- JDK: **17** (default, Gradle/Android) and **21** at `/opt/homebrew/opt/openjdk@21` (firebase-tools 15 emulators require ≥21 — `rules:test` sets it).
- Android: SDK platforms 29–36, AVDs `Pixel_Tablet` (landscape POS) and `Pixel_9_Pro_Fold`. iOS: Xcode 27.
- Never copy credential files from sibling projects (service-account.json, keystores, pem).

## Ecosystem

Part of **PostX** (see `/Volumes/PostXMaster/CLAUDE.md`). Second Brain note: `Projects/px-pos.md` (sync with `/brain-sync`).

## Skills to use

- `vercel:shadcn` / `npx shadcn@latest add` — admin components
- `mobile-app-ui-design`, `mobile-a11y` — pos-app screens
- `/taster` — before any deploy (both apps)
- `playwright-skill` — admin golden paths + layout checks at 1440/390 px

## Git & deploy

- Repo: `github.com/ADXbyPostX/px-pos` (`main` = production). **Never commit unless Mandy asks.**
- pos-admin deploys on Vercel (team post-x, project `px-pos`) from every push: `main` → production, other branches → previews. Project settings: root `apps/pos-admin`, install `cd ../.. && npm ci` (workspace root, so `@px-pos/core` resolves), region `bom1` (`apps/pos-admin/vercel.json`). `NEXT_PUBLIC_FIREBASE_*` are set for production + preview; `NEXT_PUBLIC_DEV_PERSONAS` is never set there.
- Security headers (CSP allowing only Firebase on `*.googleapis.com`) live in `apps/pos-admin/next.config.ts`; adding a third-party service means adding it to the CSP.
