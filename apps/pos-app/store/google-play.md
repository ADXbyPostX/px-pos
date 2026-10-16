# PX POS on Google Play

Everything the Play Console asks for, ready to paste. App id `in.postx.pxpos`, in the same Play Console account as ADX (`com.postx.adx`).

## 1. Release tracks

- **Internal testing** (Test and release → Testing → Internal testing): up to 100 Google accounts, no store page or review needed. Use it for our own devices and to move Tea Room's tills onto Play.
- **Production** (Test and release → Production): needs every section below plus Google's review. Before submitting, the reviewer needs a way in (see App access).
- Production → **Countries / regions** → Add → **India**.
- The warning "There is no deobfuscation file…" can be ignored. The till isn't shrunk or obfuscated (R8 is off), so there's no file to upload.

## 2. Store listing (Grow users → Store presence → Main store listing)

**App name** (30 max)
```
PX POS
```

**Short description** (80 max)
```
Billing and point of sale for PostX restaurants and cafés. Works offline.
```

**Full description** (4000 max)
```
PX POS is the till for restaurants, cafés and tea shops that run on PostX. It takes orders, prints GST bills and keeps selling when the internet drops.

Take every kind of order
• Quick counter orders with token numbers
• Dine-in by table, with covers
• Delivery orders with the customer's phone and address
• Hold an order and come back to it later

Kitchen tickets
• Send KOTs to the kitchen printer or to a kitchen screen
• Add-ons and cancellations print as their own tickets

Bills and payments
• GST bills with CGST and SGST worked out from your menu prices (prices include GST)
• Cash, UPI, card and other payments, including split payments
• A UPI QR code with the amount on screen, for the customer to scan and pay you directly
• Your logo on the bill, and you choose which lines print

Printers and counter hardware
• The built-in printer, cash drawer and customer display on supported Android POS terminals
• Bluetooth and network (LAN) thermal printers, 58 mm and 80 mm

Keeps working offline
• Sales are saved on the device and sync when the connection is back
• Bill numbers stay in order, with no duplicates

End of day
• Cash count, Z report and day close on the till
• Staff sign in with their own name and PIN

Everything is set up from PX POS Admin on the web: menu and prices, GST, staff, tables, receipt and order types.

PX POS is for outlets set up by PostX. A device must be paired by PostX before it can take orders. To use PX POS at your outlet, contact PostX at postx.in.
```

**App category:** Business. **Contact email:** adxbypostx@gmail.com (or a PostX support address). **Website:** https://postx.in

**Graphics** (Claude makes these):
- App icon: 512×512 PNG
- Feature graphic: 1024×500
- Phone screenshots: at least 2
- Tablet screenshots: 7-inch and 10-inch (the till is used mostly on tablets and POS terminals)

## 3. App content (Policy and programs → App content)

| Section | Answer |
|---|---|
| Privacy policy | `https://px-pos.vercel.app/privacy` (published once the wording in `privacy-policy.md` is approved) |
| Ads | **No**, the app doesn't contain ads |
| App access | **All or some functionality is restricted.** Add instructions with the reviewer invite code (being built; needed before Production) |
| Content rating | Category **"All other app types"**. Answer **No** to every question (no violence, no user-generated content shared between users, no location sharing, no digital purchases). Expected rating: Everyone / 3+ |
| Target audience | **18 and over** only. Not designed for children |
| News app | **No** |
| Government app | **No** |
| Financial features | **"My app doesn't provide any financial features."** The till records how a bill was paid but never holds, moves or processes money. UPI payments go from the customer's own UPI app straight to the outlet |
| Health | **No health features** |
| Advertising ID | **No**, the app doesn't use the advertising ID |
| Data safety | See below |

### Data safety

- Does the app collect or share user data? **Yes**
- Is all user data encrypted in transit? **Yes** (Firebase over HTTPS)
- Can users ask for their data to be deleted? **Yes**, by emailing PostX (the outlet's customer records are deleted on request)
- Is any data shared with third parties? **No**. Google Firebase stores it as our service provider, which doesn't count as sharing
- Data types **collected**, all for **App functionality**, not shared, not used for ads:

| Data type | What it is in PX POS | Required? |
|---|---|---|
| Personal info → Name | Customer name on an order (optional); staff names | Optional |
| Personal info → Phone number | Delivery customer's phone | Optional |
| Personal info → Address | Delivery address | Optional |
| Financial info → Purchase history | Orders and bills | Required |
| Device or other IDs | The till's app ID used to pair it, and its device name and model | Required |

Nothing else is collected: no location, contacts, photos, files, messages, audio, health, web browsing, analytics or crash reports.
