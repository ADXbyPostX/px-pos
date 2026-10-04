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
- **Admin** — sees/manages only clients whose `adminUids` contains them. pos-admin only.
- **Client owner** and **employees** (manager / cashier / captain / kitchen) — pos-app only.
- **Phase 1 = no login screens.** Anonymous Firebase Auth everywhere; access comes from Firestore docs (`platformUsers/{uid}`, `clients/{c}/members/{uid}`). Terminals pair by on-screen code. Super admin is claimed once at `/setup` and linked to email/password (same uid).
- Phase 2 adds login without migrating data: admin email login + invites with the **same** uid as the existing `platformUsers` doc; in the app, owner/staff authenticate *inside* the app (PIN / signed grant). **A terminal's Firebase uid never changes** — its offline write queue is keyed to it.

## Brand

- Dark only, pure black `#000` + signature red `#fc0303` (logo SVGs use `#fe0101` — keep as supplied).
- Assets live in each app (moved there from the repo root on 2026-09-29):
  - `apps/pos-admin/public/brand/{favicon,postxpos,pxpos}/`
  - `apps/pos-app/assets/brand/{favicon,postxpos,pxpos}/` (RN bundles only `require()`d images; Expo `public/` is web-only)
- Usage: **favicon/** (PX mark) → browser chrome, app icons, collapsed sidebar, 404. **postxpos** (main wordmark) → `/setup`, app splash/pairing/lock. **pxpos** (short wordmark) → expanded sidebar, app rail, PDFs/receipts (`-black` on paper).
- One registry per app: `apps/pos-admin/src/lib/brand.ts`, `apps/pos-app/src/lib/brand.ts`. A logo swap touches only these + the files.
- App launcher icons are rendered at 1024 by `npm run icons` (Inkscape) from the SVGs.

## Conventions — pos-admin UI (px-ops rules, Mandy 2026-09-04)

- Mirrors `/Volumes/PostXMaster/Developer/px-ops` shell exactly (sidebar/header/brand pattern).
- **Flat surfaces only**: no shadows, glass, blur or glows. `globals.css` zeroes every `shadow-*`. Strip `backdrop-blur` and `shadow-*` from every shadcn component you add. Background layer only: `.bg-ember` (Mandy, 2026-09-29, replaced the px-ops dot grid): one `<div aria-hidden className="bg-ember" />` in the app shell, `/setup` and 404. It gives two faint brand-red glows drifting on 76/92 s loops over pure black, with a static crown and black film grain. It animates transform/opacity only and stays static under reduced motion.
- **No subtitles, helper text or visible page titles.** `PageHeader` renders an sr-only h1; toolbars, filters and primary buttons are portalled into the top bar (`#header-actions`).
- **One full-width container**, `p-4 md:p-6`. **Never** a centred max-width container. Use the space: stats strips, grids, dense tables, side sheets.
- **The page never scrolls; only the content pane does.** Table heads and Panel titles are sticky at `-top-4 md:-top-6`. Cards use `overflow-clip`, never `overflow-hidden`.
- Add components only with `npx shadcn@latest add <name>` (from `apps/pos-admin`), then `grep -rn "shadow-\|backdrop-blur" src/components/ui` must be empty. Never re-add a component px-ops already customised (toggle-group, input-group, table, sidebar …); answer **no** to overwrites.
- Status colours: white / zinc / brand red, plus blue (`--qc`), green (`--success`), yellow (`--warning`) each for one purpose.
- Every async surface: loading (skeleton) + empty + error (Panel with Retry). Every route has `loading.tsx` + `error.tsx`; root has `not-found.tsx` + `global-error.tsx`. `Loadable` wraps every live listener.
- Forms: `useState` + manual validation (validators from `@px-pos/core`), `FormDialog` (Dialog desktop / bottom Sheet mobile). No react-hook-form/zod. No raw `<select>`, `alert()`, `confirm()`.

## Conventions — pos-app UI

- Tablet rail + phone bottom tabs come from one hook (`useTillNav`); phones get full-screen ticket/pay views, never side panels.
- NativeWind gotchas: put `active:` classes **on the Pressable itself**, never on a child View (NativeWind attaches touch handlers to it and the tap never reaches the Pressable). Horizontal `ScrollView`s need `grow-0` or they stretch vertically.
- **Hold (park) orders** (`src/local/held.ts`): unsent quick/delivery tickets are SQLite drafts with a `held` marker — terminal-only, offline, never written to Firestore until paid/sent. A ticket left unfinished on screen change is listed too ("not finished"). The held name becomes `customer.name` and prints as "Token 3 - Ravi". Dine-in doesn't hold (the table is the hold).
- Drive the device by accessibility label (`uiautomator dump` + `input tap`), not pixel guesses — every Pressable needs an `accessibilityLabel`.
- **Payments** (`pay-panel.tsx`): Cash, UPI, Card and Other are recorded tenders; there's no payment gateway. UPI shows an NPCI `upi://pay` QR with the amount (on screen, and on the customer display when the compact link fits a version-3 QR) once admin › Settings › Payments has the outlet's UPI ID (`client.upi`); the cashier confirms the money arrived (soundbox/app), then completes. Card is charged on the bank's separate card machine. Complete settles with the amount on screen; Split takes part now and the rest another way. The panel never scrolls: the keypad (`Keypad fill`) takes the free height, and phones hide the tab bar while paying.
- **Terminal hardware** (`modules/pos-hardware`, Kotlin; tested on the TVS TP-482C = Aclas AOBX board, USB `6778:0112`). Sync screen → Hardware has a check for each:
  - Printer: USB printer-class interface 0, raw ESC/POS (`printUsb`).
  - Customer display (132×65 dot-matrix): HID interface 1 (`/dev/hidraw0`; SELinux is permissive on this build). Frames `20 00 1F len | 0A cmd data | ~xor 03` as HID output reports 0x50–0x58 by size; images are `GS v 0` rasters, 13 rows per frame, each acked. `src/hardware/customer-display.ts` decides what it shows (welcome → last item + total → please pay → thank you).
  - Cash drawer: Aclas pulse `1B 71 00 3C FF` + `1B 43 00 00 00` through the printer pipe, sent without a paper check. Opens on any cash tender; a manual open is recorded as a `no_sale` cash movement.

## Conventions — data (both apps)

- **Deviation from px-ops (deliberate):** admin uses the **client Firebase SDK with live `onSnapshot`** (pXclusive pattern), not server actions + Admin SDK. Terminals write Firestore directly while offline, so **Firestore rules are the security boundary** for both apps. No Admin SDK anywhere in phase 1.
- **Money is integer paise** (`Paise`), rates are basis points (`Bps`, 500 = 5%). Never floats. Format only with `formatINR` from core (hand-written en-IN grouping, no `Intl` — Hermes-safe).
- **Item photos** live in `itemPhotos/{itemId}` (not on the item): a 400 px square JPEG as base64, ≤ 200 KB, made in the browser (`apps/pos-admin/src/lib/photo.ts`). Inline data works on Spark (no Storage bucket) and reaches terminals through the offline cache. The `data` field is index-exempt, audit entries never carry it, and removing a photo sets `active:false`. Bulk upload matches file names to dish names (`matchPhotoFiles`).
- **Every item stores its own GST rate** (`taxBps`, required by `validateItem`), picked when it's created — never "outlet default". Slabs are GST 2.0 (`TAX_RATES`: 0/5/18/40%). `null` survives only on legacy items (billed at the outlet default, flagged `*` in admin).
- **Time**: IST fixed +330 min, no `Intl`. Sales are stamped with the terminal's open business day (`days/{bizDate}`), not the device clock. Invoice date/FY = IST calendar date at issue.
- **Every multi-doc change is a `WritePlan`** built by `@px-pos/core` plans and applied as one batch (`apply-plan.ts` in each app). UI never awaits a sale write (offline-first). Only pairing and Z close use `runTransaction` (online only).
- **Exactly-once aggregates**: any batch that increments `dailyStats` or `stock` contains exactly **one** `postings/{key}` create and sets `lastPostingKey:key`; rules reject replays atomically.
- **Offline numbering** (app): SQLite counters (keys scoped by terminal doc id — a re-paired device starts fresh) + journal via `allocateAndJournal(actionKey, …)` — idempotent per action (double taps can't burn an invoice number). Invoice no `DC1/26-27/000123` (≤16 chars), series = client prefix + terminal code; terminal codes are never reused.
- **Never hard-delete.** `active:false` or a `status` (`cancelled`/`void`). Rules deny delete everywhere.
- Common fields: `schemaVersion`, `createdAtMs` (device), `createdAt` (serverTimestamp), `updatedAtMs`, `source`, `terminalId?`, `staffId?`, `outletId:'main'` on transactional docs.
- Collection names/paths live in `@px-pos/core` (`paths.ts`) — never hand-type a path.
- Known phase-1 rule gaps (by design, closed in phase 2): unsettled orders are loosely writable by members; per-role limits are UI + audit only; staff PINs are not a security boundary.

## Commands

```bash
npm install                       # root only (workspaces)
npm run dev:admin                 # pos-admin on :3000
npm test                          # @px-pos/core unit tests
npm run rules:test                # rules tests on the Firestore emulator (JDK 21, see Environment)
npm run rules:deploy              # deploy rules + indexes to postx-pos (adxbypostx account) — Mandy runs this herself
npm run icons                     # render app icons (Inkscape)
cd apps/pos-app && npx expo run:android   # dev build on emulator/device (JDK 17)
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

## Git

`git init` done; **never commit unless Mandy asks.**
