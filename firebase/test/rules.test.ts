import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, increment, query, setDoc, updateDoc, where } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  billPlan,
  bootstrapPlan,
  closeDayPlan,
  computeBill,
  createClientPlan,
  dayOpenPlan,
  invoiceLinesFor,
  itemPhotoPlan,
  kotPlan,
  openingBalancePlan,
  pairPlan,
  pairingRequestPlan,
  purchaseEditPlan,
  purchasePlan,
  purchaseVoidPlan,
  quickPlan,
  rebillPlan,
  rejectPairingPlan,
  reopenBillPlan,
  revokeTerminalPlan,
  settlePlan,
  settleTenders,
  terminalUpdatePlan,
  upsertItemPlan,
  upsertMaterialPlan,
  upsertVendorPlan,
  vendorPaymentPlan,
  vendorPaymentVoidPlan,
  zClosePlan,
} from "@px-pos/core";
import type { OrderLine, OrderRef, PlanCtx, PurchaseInput, VendorProfile, ZReport } from "@px-pos/core";
import { applyPlan } from "./apply-plan";

const here = dirname(fileURLToPath(import.meta.url));
const BD = "2026-09-29";
const NOW = Date.parse("2026-09-29T08:35:00Z");
let env: RulesTestEnvironment;
let idn = 0;
const newId = () => `x${++idn}`;

const adminCtx = (uid: string, cid = "c1"): PlanCtx => ({ cid, nowMs: NOW, actorId: uid, actorKind: "platform", source: "admin", newId });
const termCtx = (cid = "c1", terminalId = "t1"): PlanCtx => ({ cid, nowMs: NOW, actorId: "staff1", actorKind: "staff", terminalId, source: "app", newId });
const db = (uid?: string): Firestore => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore()) as unknown as Firestore;
const client = { taxMode: "regular" as const, priceMode: "exclusive" as const, rounding: "rupee" as const, defaultTaxBps: 500 };
const supplier = { legalName: "Demo Cafe Pvt Ltd", fssai: "12345678901234", address: "1 Road", stateName: "Maharashtra", stateCode: "27", gstin: "27AAPFU0939F1ZV" };
const tracked = new Set(["paneer"]);

function line(id: string, itemId: string, qty: number, extra: Partial<OrderLine> = {}): OrderLine {
  return { lineId: id, seq: 1, itemId, name: itemId, categoryId: "cat1", station: "kitchen", unitPricePaise: 20000, qty, taxBps: null, sentQty: 0, voidedQty: 0, addedBy: "staff1", addedAtMs: NOW, ...extra };
}
const billFor = (lines: OrderLine[]) =>
  computeBill({
    lines: lines.map((l) => ({ lineId: l.lineId, unitPricePaise: l.unitPricePaise, qty: l.qty, voidedQty: l.voidedQty, taxBps: l.taxBps })),
    serviceChargeOptIn: false,
    charges: { packagingPaise: 0, packagingOn: [], deliveryPaise: 0, serviceChargeBps: 0 },
    mode: "dineIn",
    client,
  });
const inv = (seq: number) => ({ series: "DC1", fy: "26-27", seq, invoiceNo: `DC1/26-27/${String(seq).padStart(6, "0")}`, invoiceId: `DC1-2627-${String(seq).padStart(6, "0")}`, dateIST: BD });

function quick(orderId: string, seq: number) {
  const lines = [line("a", "paneer", 1)];
  const bill = billFor(lines);
  const t = settleTenders(bill.grandTotalPaise, 0, [{ mode: "cash", amountPaise: 50000 }]);
  if (!t.ok) throw new Error("tender");
  return quickPlan(termCtx(), {
    create: { id: orderId, orderNo: `1-00${seq}`, mode: "quick", businessDate: BD, token: seq },
    lines,
    alloc: { numbers: [seq], terminalCode: "1" },
    bill,
    invoiceLines: invoiceLinesFor(lines, bill),
    invoice: inv(seq),
    supplier,
    docType: "tax_invoice",
    applied: t.applied,
    tipPaise: 0,
    tracked,
  });
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(d, "platformUsers/super"), { role: "superadmin", name: "Mandy", active: true });
    await setDoc(doc(d, "platformUsers/adminA"), { role: "admin", name: "A", active: true });
    await setDoc(doc(d, "platformUsers/adminB"), { role: "admin", name: "B", active: true });
    for (const [cid, admins] of [["c1", ["adminA"]], ["c2", ["adminB"]]] as const) {
      const p = createClientPlan({ ...adminCtx("super", cid) }, { name: `Client ${cid}`, legalName: "L", address: "A", city: "Mumbai", stateName: "Maharashtra", stateCode: "27", fssai: "12345678901234", invoicePrefix: "DC", adminUids: [...admins] });
      await applyPlan(d, p);
    }
    await applyPlan(d, pairingRequestPlan({ uid: "dev1", code: "PXP-0000-0001", deviceName: "Tab", model: "Pixel Tablet", platform: "android", appVersion: "0.1.0", nowMs: NOW }));
    await applyPlan(d, pairPlan(adminCtx("super"), { requestUid: "dev1", terminalId: "t1", code: "1", name: "Counter", mode: "pos", series: "DC1", fy: "26-27" }));
    await applyPlan(
      d,
      upsertItemPlan(adminCtx("super"), {
        id: "paneer",
        item: { name: "Paneer", categoryId: "cat1", sort: 1, foodType: "veg", pricePaise: 20000, variants: [], taxBps: null, modes: ["dineIn", "quick"], trackStock: true, unit: "plate", lowAt: 2, available: true, active: true },
        openingQty: 10,
        businessDate: BD,
      }),
    );
  });
}

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-px-pos",
    firestore: { rules: readFileSync(resolve(here, "../firestore.rules"), "utf8"), host, port: Number(port) },
  });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

describe("no identity, no access", () => {
  it("unauthenticated and stray anonymous users are denied", async () => {
    await assertFails(getDoc(doc(db(), "clients/c1")));
    await assertFails(getDoc(doc(db("rando"), "clients/c1")));
    await assertFails(getDocs(collection(db("rando"), "clients")));
    await assertFails(setDoc(doc(db("rando"), "clients/c9"), { name: "x" }));
    await assertFails(getDoc(doc(db("rando"), "clients/c1/items/paneer")));
  });
});

describe("bootstrap", () => {
  it("can be claimed exactly once, only together with the caller's superadmin doc", async () => {
    await assertFails(setDoc(doc(db("eve"), "platformUsers/eve"), { role: "superadmin", name: "Eve", active: true }));
    await assertFails(setDoc(doc(db("eve"), "meta/bootstrap"), { uid: "eve", atMs: 1 }));
    await assertSucceeds(applyPlan(db("mandy"), bootstrapPlan({ uid: "mandy", name: "Mandy", nowMs: NOW })));
    await assertFails(applyPlan(db("eve"), bootstrapPlan({ uid: "eve", name: "Eve", nowMs: NOW })));
    await assertSucceeds(getDoc(doc(db("mandy"), "platformUsers/mandy")));
  });
});

describe("tenancy", () => {
  it("admins see only assigned clients and cannot reassign themselves", async () => {
    await assertSucceeds(getDoc(doc(db("adminA"), "clients/c1")));
    await assertFails(getDoc(doc(db("adminA"), "clients/c2")));
    await assertSucceeds(getDocs(query(collection(db("adminA"), "clients"), where("adminUids", "array-contains", "adminA"))));
    await assertFails(getDocs(collection(db("adminA"), "clients")));
    await assertSucceeds(updateDoc(doc(db("adminA"), "clients/c1"), { name: "Renamed" }));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c1"), { adminUids: ["adminA", "adminB"] }));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c2"), { name: "Nope" }));
    await assertSucceeds(updateDoc(doc(db("super"), "clients/c1"), { adminUids: ["adminA", "adminB"] }));
    await assertSucceeds(getDocs(collection(db("super"), "clients")));
  });

  it("a paired terminal reads its client and may only toggle item availability", async () => {
    const d = db("dev1");
    await assertSucceeds(getDoc(doc(d, "clients/c1")));
    await assertSucceeds(getDocs(collection(d, "clients/c1/items")));
    await assertFails(getDoc(doc(d, "clients/c2")));
    await assertFails(getDocs(collection(d, "clients/c2/items")));
    await assertSucceeds(updateDoc(doc(d, "clients/c1/items/paneer"), { available: false, updatedAtMs: NOW }));
    await assertFails(updateDoc(doc(d, "clients/c1/items/paneer"), { pricePaise: 1 }));
    await assertFails(setDoc(doc(d, "clients/c1/items/new"), { name: "x" }));
    await assertFails(updateDoc(doc(d, "clients/c1"), { name: "hack" }));
  });

  it("item photos: admins of the client set and clear them, terminals only read, nothing deletes", async () => {
    const photo = { mime: "image/jpeg" as const, w: 400, h: 400, bytes: 3, data: "QUJD" };
    await assertSucceeds(applyPlan(db("adminA"), itemPhotoPlan(adminCtx("adminA"), { itemId: "paneer", itemName: "Paneer", photo, hadPhoto: false })));
    await assertFails(applyPlan(db("adminB"), itemPhotoPlan(adminCtx("adminB"), { itemId: "paneer", itemName: "Paneer", photo, hadPhoto: true })));
    await assertSucceeds(getDocs(collection(db("dev1"), "clients/c1/itemPhotos")));
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/itemPhotos/paneer"), { itemId: "paneer", mime: "image/jpeg", data: "", active: false }));
    // The doc id must be the item id, and the image must stay small.
    await assertFails(setDoc(doc(db("adminA"), "clients/c1/itemPhotos/other"), { itemId: "paneer", mime: "image/jpeg", data: "QUJD", active: true }));
    await assertFails(setDoc(doc(db("adminA"), "clients/c1/itemPhotos/paneer"), { itemId: "paneer", mime: "image/jpeg", data: "A".repeat(300_000), active: true }));
    await assertSucceeds(applyPlan(db("adminA"), itemPhotoPlan(adminCtx("adminA"), { itemId: "paneer", itemName: "Paneer", photo: null, hadPhoto: true })));
    await assertFails(deleteDoc(doc(db("super"), "clients/c1/itemPhotos/paneer")));
  });

  it("pairing: a device requests, only the super admin can see, pair or reject it", async () => {
    await assertSucceeds(applyPlan(db("dev9"), pairingRequestPlan({ uid: "dev9", code: "PXP-ABCD-EFGH", deviceName: "Tab", model: "X", platform: "android", appVersion: "0.1.0", nowMs: NOW })));
    await assertFails(applyPlan(db("dev8"), pairingRequestPlan({ uid: "dev9", code: "PXP-ABCD-EFGH", deviceName: "Tab", model: "X", platform: "android", appVersion: "0.1.0", nowMs: NOW })));
    const pairInput = { requestUid: "dev9", terminalId: "t9", code: "9", name: "Bar", mode: "pos" as const, series: "DC9", fy: "26-27" };
    // Even an admin of c1 can't list, pair or reject.
    await assertFails(getDocs(query(collection(db("adminA"), "pairingRequests"), where("status", "==", "pending"))));
    await assertFails(getDoc(doc(db("adminA"), "pairingRequests/dev9")));
    await assertFails(applyPlan(db("adminA"), pairPlan(adminCtx("adminA"), pairInput)));
    await assertFails(applyPlan(db("adminA"), rejectPairingPlan(NOW, "dev9")));
    await assertSucceeds(getDocs(query(collection(db("super"), "pairingRequests"), where("status", "==", "pending"))));
    await assertSucceeds(applyPlan(db("super"), pairPlan(adminCtx("super"), pairInput)));
    await assertSucceeds(getDoc(doc(db("dev9"), "clients/c1")));
  });

  it("admins manage a paired terminal but can't re-pair, un-revoke or renumber it", async () => {
    await assertSucceeds(applyPlan(db("adminA"), terminalUpdatePlan(adminCtx("adminA"), "t1", { name: "Front", catalog: "side" }, { name: "Counter" })));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c1/terminals/t1"), { authUid: "someone", updatedAtMs: NOW }));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c1/terminals/t1"), { lastInvoiceSeq: 99, updatedAtMs: NOW }));
    await assertFails(setDoc(doc(db("adminA"), "clients/c1/members/devX"), { role: "terminal", terminalId: "t1", active: true, createdAtMs: NOW, updatedAtMs: NOW }));
    await assertSucceeds(applyPlan(db("adminA"), revokeTerminalPlan(adminCtx("adminA"), { id: "t1", authUid: "dev1", name: "Counter" }, "lost")));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c1/terminals/t1"), { status: "active", updatedAtMs: NOW }));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c1/members/dev1"), { active: true, updatedAtMs: NOW }));
    await assertSucceeds(updateDoc(doc(db("super"), "clients/c1/terminals/t1"), { status: "active", updatedAtMs: NOW }));
  });
});

describe("terminal sales: exactly-once and invoice integrity", () => {
  it("a quick order batch lands once; a replay is rejected whole", async () => {
    const p = quick("q1", 1);
    await assertSucceeds(applyPlan(db("dev1"), p));
    const stats = await getDoc(doc(db("super"), `clients/c1/dailyStats/${BD}`));
    expect(stats.data()?.totalPaise).toBe(20000); // ₹200 menu price, GST inside it
    expect(stats.data()?.orders).toBe(1);
    const stock = await getDoc(doc(db("super"), "clients/c1/stock/paneer"));
    expect(stock.data()?.onHand).toBe(9);
    await assertFails(applyPlan(db("dev1"), p));
    const again = await getDoc(doc(db("super"), `clients/c1/dailyStats/${BD}`));
    expect(again.data()?.totalPaise).toBe(20000);
  });

  it("stats cannot be incremented without a new posting", async () => {
    await assertFails(setDoc(doc(db("dev1"), `clients/c1/dailyStats/${BD}`), { totalPaise: 999, lastPostingKey: "fake" }, { merge: true }));
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/stock/paneer"), { onHand: 999 }, { merge: true }));
  });

  it("invoice numbers must advance within the terminal's own series", async () => {
    await assertSucceeds(applyPlan(db("dev1"), quick("q1", 1)));
    await assertFails(applyPlan(db("dev1"), quick("q2", 1)));
    await assertSucceeds(applyPlan(db("dev1"), quick("q2", 2)));
  });

  it("an order's invoice can never be swapped (two tablets billing one table)", async () => {
    const lines = [line("a", "paneer", 1)];
    const k = kotPlan(termCtx(), { order: { create: { id: "o1", orderNo: "1-010", mode: "dineIn", businessDate: BD, tableId: "tab4", tableLabel: "T4", covers: 2 } }, lines, alloc: { numbers: [30], terminalCode: "1" }, tracked });
    await assertSucceeds(applyPlan(db("dev1"), k));
    const o: OrderRef = { id: "o1", orderNo: "1-010", mode: "dineIn", businessDate: BD, terminalId: "t1", kotCount: 1, status: "open", lines: { a: { ...lines[0]!, sentQty: 1 } }, tableLabel: "T4" };
    const bill = billFor(lines);
    await assertSucceeds(applyPlan(db("dev1"), billPlan(termCtx(), { order: o, bill, lines: invoiceLinesFor(lines, bill), invoice: inv(1), supplier, docType: "tax_invoice" })));
    await assertFails(applyPlan(db("dev1"), billPlan(termCtx(), { order: o, bill, lines: invoiceLinesFor(lines, bill), invoice: inv(2), supplier, docType: "tax_invoice" })));
  });

  it("edit bill keeps the number while unsettled; a settled order is frozen", async () => {
    const lines = [line("a", "paneer", 1)];
    await assertSucceeds(applyPlan(db("dev1"), kotPlan(termCtx(), { order: { create: { id: "o1", orderNo: "1-010", mode: "dineIn", businessDate: BD, tableId: "tab4", tableLabel: "T4" } }, lines, alloc: { numbers: [30], terminalCode: "1" }, tracked })));
    let o: OrderRef = { id: "o1", orderNo: "1-010", mode: "dineIn", businessDate: BD, terminalId: "t1", kotCount: 1, status: "open", lines: { a: { ...lines[0]!, sentQty: 1 } }, tableLabel: "T4" };
    const bill = billFor(lines);
    await assertSucceeds(applyPlan(db("dev1"), billPlan(termCtx(), { order: o, bill, lines: invoiceLinesFor(lines, bill), invoice: inv(1), supplier, docType: "tax_invoice" })));
    o = { ...o, status: "billed", invoiceId: inv(1).invoiceId, invoiceNo: inv(1).invoiceNo, bill };
    await assertSucceeds(applyPlan(db("dev1"), reopenBillPlan(termCtx(), o)));
    const lines2 = [line("a", "paneer", 1, { sentQty: 1 }), line("b", "paneer", 1, { sentQty: 1, seq: 2 })];
    const bill2 = billFor(lines2);
    await assertSucceeds(applyPlan(db("dev1"), rebillPlan(termCtx(), { order: { ...o, status: "open" }, bill: bill2, lines: invoiceLinesFor(lines2, bill2), before: bill })));
    const t = settleTenders(bill2.grandTotalPaise, 0, [{ mode: "upi", amountPaise: bill2.grandTotalPaise }]);
    if (!t.ok) throw new Error("tender");
    await assertSucceeds(applyPlan(db("dev1"), settlePlan(termCtx(), { order: { ...o, bill: bill2 }, bill: bill2, series: "DC1", applied: t.applied, tipPaise: 0 })));
    await assertFails(applyPlan(db("dev1"), rebillPlan(termCtx(), { order: o, bill, lines: invoiceLinesFor(lines, bill) })));
    await assertFails(applyPlan(db("dev1"), reopenBillPlan(termCtx(), { ...o, status: "billed" })));
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1/orders/o1"), { status: "open" }));
  });

  it("nothing can ever be deleted", async () => {
    await assertSucceeds(applyPlan(db("dev1"), quick("q1", 1)));
    await assertFails(deleteDoc(doc(db("super"), "clients/c1/orders/q1")));
    await assertFails(deleteDoc(doc(db("super"), "clients/c1/invoices/DC1-2627-000001")));
    await assertFails(deleteDoc(doc(db("super"), "clients/c1")));
  });
});

describe("revoke", () => {
  it("a revoked terminal can no longer read or flush queued writes", async () => {
    await assertSucceeds(applyPlan(db("super"), revokeTerminalPlan(adminCtx("super"), { id: "t1", authUid: "dev1", name: "Counter" }, "lost tablet")));
    await assertFails(getDoc(doc(db("dev1"), "clients/c1")));
    await assertFails(applyPlan(db("dev1"), quick("q1", 1)));
  });

  it("a removed terminal can republish its pairing request; a live one cannot", async () => {
    const fresh = pairingRequestPlan({ uid: "dev1", code: "PXP-2222-3333", deviceName: "Tab", model: "Pixel Tablet", platform: "android", appVersion: "0.1.0", nowMs: NOW });
    await assertFails(applyPlan(db("dev1"), fresh)); // still live in c1: can't un-pair itself
    await assertSucceeds(applyPlan(db("super"), revokeTerminalPlan(adminCtx("super"), { id: "t1", authUid: "dev1", name: "Counter" }, "replaced")));
    await assertSucceeds(applyPlan(db("dev1"), fresh));
    await assertFails(applyPlan(db("dev2"), pairingRequestPlan({ uid: "dev1", code: "PXP-4444-5555", deviceName: "X", model: "X", platform: "android", appVersion: "0.1.0", nowMs: NOW })));
  });
});

describe("day close", () => {
  it("closed days are locked for members; late orders still land; super admin can reopen", async () => {
    await assertSucceeds(applyPlan(db("dev1"), dayOpenPlan(termCtx(), { businessDate: BD, floatPaise: 200000, createDay: true })));
    const z = zClosePlan(termCtx(), { businessDate: BD, zNo: 1, z: { zNo: 1, totalPaise: 0 } as ZReport, snapshot: { paneer: 10 } });
    await assertSucceeds(applyPlan(db("dev1"), z));
    await assertFails(applyPlan(db("dev1"), dayOpenPlan(termCtx(), { businessDate: BD, floatPaise: 100000, createDay: true })));
    await assertSucceeds(applyPlan(db("dev1"), quick("late1", 1)));
    await assertFails(updateDoc(doc(db("dev1"), `clients/c1/days/${BD}`), { status: "open" }));
    await assertSucceeds(updateDoc(doc(db("super"), `clients/c1/days/${BD}`), { status: "open" }));
    // lastZNo can only step by one.
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1"), { lastZNo: 5 }));
  });
});

describe("end of day (closeDayPlan)", () => {
  const drawerDoc = { id: `${BD}_t1`, terminalId: "t1", businessDate: BD, openingFloatPaise: 200000, openedBy: "staff1", openedAtMs: NOW, status: "open" as const, updatedAtMs: NOW };
  const input = (counts: Record<string, { countedPaise?: number }>) => ({ businessDate: BD, lastZNo: 0, day: { status: "open" as const }, stats: null, drawers: [drawerDoc], invoices: [], prevSnapshot: null, counts });

  it("the till closes its drawer and the day in one batch; it can't close it twice", async () => {
    await assertSucceeds(applyPlan(db("dev1"), dayOpenPlan(termCtx(), { businessDate: BD, floatPaise: 200000, createDay: true })));
    const { plan } = closeDayPlan(termCtx(), input({ t1: { countedPaise: 200000 } }));
    await assertSucceeds(applyPlan(db("dev1"), plan));
    await assertFails(applyPlan(db("dev1"), closeDayPlan(termCtx(), { ...input({ t1: { countedPaise: 200000 } }), lastZNo: 1 }).plan));
  });

  it("a day whose day and drawer records were wiped still closes, from the till and from admin", async () => {
    await assertSucceeds(applyPlan(db("dev1"), closeDayPlan(termCtx(), { ...input({ t1: { countedPaise: 5000 } }), day: null, drawers: [] }).plan));
    const day = await getDoc(doc(db("dev1"), `clients/c1/days/${BD}`));
    expect(day.data()).toMatchObject({ status: "closed", zNo: 1 });
    const other = "2026-09-30";
    await assertSucceeds(applyPlan(db("adminA"), closeDayPlan(adminCtx("adminA"), { ...input({}), businessDate: other, lastZNo: 1, day: null, drawers: [], stats: { cash: { t1: { sales: 100, refunds: 0, paidIn: 0, paidOut: 0, drops: 0 } } } }).plan));
  });

  it("the outlet's admin can close it from admin without a count; another client's admin can't", async () => {
    await assertSucceeds(applyPlan(db("dev1"), dayOpenPlan(termCtx(), { businessDate: BD, floatPaise: 200000, createDay: true })));
    await assertFails(applyPlan(db("adminB"), closeDayPlan(adminCtx("adminB"), input({})).plan));
    await assertSucceeds(applyPlan(db("adminA"), closeDayPlan(adminCtx("adminA"), input({})).plan));
    const day = await getDoc(doc(db("adminA"), `clients/c1/days/${BD}`));
    expect(day.data()).toMatchObject({ status: "closed", zNo: 1 });
  });
});

describe("cross-client views", () => {
  it("collection-group reads are super-admin only", async () => {
    await assertSucceeds(applyPlan(db("dev1"), quick("q1", 1)));
    await assertSucceeds(getDocs(collectionGroup(db("super"), "terminals")));
    await assertSucceeds(getDocs(query(collectionGroup(db("super"), "dailyStats"), where("businessDate", "==", BD))));
    await assertSucceeds(getDocs(collectionGroup(db("super"), "days")));
    await assertFails(getDocs(collectionGroup(db("adminA"), "terminals")));
    await assertFails(getDocs(collectionGroup(db("dev1"), "dailyStats")));
  });
});

describe("vendors", () => {
  const profile = (name = "Lakshmi Dairy"): VendorProfile => ({ name, phone: undefined, gstin: undefined, materialIds: [], creditDays: 7, note: undefined, active: true });
  const lines = [{ lineId: "l1", materialId: "milk", name: "Milk", qtyMilli: 20000, unit: "L" as const, amountPaise: 112000, taxBps: 0 }];
  const addVendor = (as = "dev1", ctx = termCtx()) => applyPlan(db(as), upsertVendorPlan(ctx, { id: "v1", vendor: profile() }));
  const buy = (id: string, extra: Partial<PurchaseInput> = {}, ctx = termCtx()) => purchasePlan(ctx, { id, vendor: { id: "v1", name: "Lakshmi Dairy" }, billDate: BD, businessDate: BD, lines, ...extra });
  const read = async (path: string) => (await getDoc(doc(db("super"), path))).data();
  const vendorDoc = (o: Record<string, unknown>) => ({ name: "X", active: true, creditDays: 0, materialIds: [], purchasedPaise: 0, paidPaise: 0, ...o });

  it("a till adds a vendor with nothing owed; it can't start with a balance", async () => {
    await assertSucceeds(addVendor());
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/vendors/v2"), vendorDoc({ purchasedPaise: 500 })));
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/vendors/v3"), vendorDoc({ lastPostingKey: "vbill:x" })));
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/vendors/v4"), vendorDoc({ name: "" })));
  });

  it("a purchase counts once; a replay is rejected whole", async () => {
    await addVendor();
    const p = buy("p1");
    await assertSucceeds(applyPlan(db("dev1"), p));
    expect((await read("clients/c1/vendors/v1"))?.purchasedPaise).toBe(112000);
    const s = await read(`clients/c1/dailyStats/${BD}`);
    expect([s?.purchasesPaise, s?.purchaseBills, s?.purchByVendor?.v1]).toEqual([112000, 1, 112000]);
    await assertFails(applyPlan(db("dev1"), p));
    expect((await read("clients/c1/vendors/v1"))?.purchasedPaise).toBe(112000);
    expect((await read(`clients/c1/dailyStats/${BD}`))?.purchasesPaise).toBe(112000);
  });

  it("profiles change freely; the totals only with a posting from the same batch", async () => {
    await addVendor();
    await assertSucceeds(updateDoc(doc(db("dev1"), "clients/c1/vendors/v1"), { name: "Lakshmi Milk", creditDays: 30, updatedAtMs: NOW }));
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1/vendors/v1"), { purchasedPaise: 999 }));
    await assertFails(updateDoc(doc(db("adminA"), "clients/c1/vendors/v1"), { paidPaise: 999 }));
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/vendors/v1"), { purchasedPaise: increment(500), lastPostingKey: "vbill:nope" }, { merge: true }));
    await applyPlan(db("dev1"), buy("p1"));
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/vendors/v1"), { purchasedPaise: increment(500), lastPostingKey: "vbill:p1" }, { merge: true }));
    await assertSucceeds(updateDoc(doc(db("super"), "clients/c1/vendors/v1"), { purchasedPaise: 0, paidPaise: 0 }));
  });

  it("paid on delivery from the drawer: one batch moves bought, paid and the drawer", async () => {
    await addVendor();
    await assertSucceeds(applyPlan(db("dev1"), buy("p1", { paidNow: { id: "pay1", amountPaise: 112000, mode: "drawer" } })));
    const s = await read(`clients/c1/dailyStats/${BD}`);
    expect([s?.cash?.t1?.paidOut, s?.cash?.t1?.paidOutVendors, s?.vendorPaidPaise]).toEqual([112000, 112000, 112000]);
    const v = await read("clients/c1/vendors/v1");
    expect([v?.purchasedPaise, v?.paidPaise]).toEqual([112000, 112000]);
  });

  it("drawer cash leaves only the drawer of the till writing it, never from admin", async () => {
    await addVendor();
    const pay = (id: string, ctx: PlanCtx, mode: "drawer" | "upi" = "drawer") => vendorPaymentPlan(ctx, { id, vendor: { id: "v1", name: "Lakshmi Dairy" }, businessDate: BD, amountPaise: 50000, mode });
    await assertFails(applyPlan(db("adminA"), pay("q1", termCtx())));
    await assertFails(applyPlan(db("dev1"), pay("q2", termCtx("c1", "t2"))));
    await assertSucceeds(applyPlan(db("dev1"), pay("q3", termCtx())));
    await assertSucceeds(applyPlan(db("adminA"), pay("q4", adminCtx("adminA"), "upi")));
    expect((await read("clients/c1/vendors/v1"))?.paidPaise).toBe(100000);
  });

  it("no purchase or payment without its own posting", async () => {
    await addVendor();
    const bare = { status: "active", kind: "bill", vendorId: "v1", totalPaise: 100, lines: [] };
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/purchases/p9"), bare));
    await applyPlan(db("dev1"), buy("p1"));
    const piggy = { status: "active", kind: "payment", vendorId: "v1", amountPaise: 100, mode: "upi", purchaseId: "p1" };
    await assertFails(setDoc(doc(db("dev1"), "clients/c1/vendorPayments/q9"), piggy));
  });

  it("voids reverse once and can't be undone or edited", async () => {
    await addVendor();
    await applyPlan(db("dev1"), buy("p1", { paidNow: { id: "pay1", amountPaise: 50000, mode: "drawer" } }));
    const ref = { id: "p1", kind: "bill" as const, vendorId: "v1", vendorName: "Lakshmi Dairy", businessDate: BD, totalPaise: 112000, gstPaise: 0, lines: lines.map((l) => ({ ...l, gstPaise: 0 })), status: "active" as const };
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1/purchases/p1"), { status: "void", void: { reason: "x", by: "s", atMs: 1 }, updatedAtMs: NOW }));
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1/purchases/p1"), { totalPaise: 1 }));
    await assertSucceeds(applyPlan(db("dev1"), purchaseEditPlan(termCtx(), { id: "p1", vendorName: "Lakshmi Dairy" }, { billNo: "1201" })));
    const v = purchaseVoidPlan(termCtx(), ref, "Entered twice");
    await assertSucceeds(applyPlan(db("dev1"), v));
    expect((await read("clients/c1/vendors/v1"))?.purchasedPaise).toBe(0);
    expect((await read(`clients/c1/dailyStats/${BD}`))?.purchasesPaise).toBe(0);
    await assertFails(applyPlan(db("dev1"), v));
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1/purchases/p1"), { status: "active", updatedAtMs: NOW }));
    const pv = vendorPaymentVoidPlan(termCtx(), { id: "pay1", kind: "payment", vendorId: "v1", vendorName: "Lakshmi Dairy", businessDate: BD, amountPaise: 50000, mode: "drawer", drawerTerminalId: "t1", status: "active" }, "Wrong amount");
    await assertSucceeds(applyPlan(db("dev1"), pv));
    expect((await read(`clients/c1/dailyStats/${BD}`))?.cash?.t1?.paidOut).toBe(0);
    expect((await read("clients/c1/vendors/v1"))?.paidPaise).toBe(0);
    await assertFails(applyPlan(db("dev1"), pv));
  });

  it("an opening balance moves only the vendor", async () => {
    await addVendor("adminA", adminCtx("adminA"));
    await assertSucceeds(applyPlan(db("adminA"), openingBalancePlan(adminCtx("adminA"), { id: "o1", vendor: { id: "v1", name: "Lakshmi Dairy" }, asOf: "2026-09-01", amountPaise: 840000 })));
    await assertSucceeds(applyPlan(db("adminA"), openingBalancePlan(adminCtx("adminA"), { id: "o2", vendor: { id: "v1", name: "Lakshmi Dairy" }, asOf: "2026-09-01", amountPaise: -50000 })));
    const v = await read("clients/c1/vendors/v1");
    expect([v?.purchasedPaise, v?.paidPaise]).toEqual([840000, 50000]);
    expect(await read("clients/c1/dailyStats/2026-09-01")).toBeUndefined();
  });

  it("materials: anyone on the outlet adds them, the unit never changes", async () => {
    const m = (unit: "L" | "kg", name = "Milk") => upsertMaterialPlan(termCtx(), { id: "milk", material: { name, unit, taxBps: 0, active: true } });
    await assertSucceeds(applyPlan(db("dev1"), m("L")));
    await assertSucceeds(updateDoc(doc(db("adminA"), "clients/c1/materials/milk"), { name: "Cow milk", updatedAtMs: NOW }));
    await assertFails(updateDoc(doc(db("dev1"), "clients/c1/materials/milk"), { unit: "kg" }));
    await assertFails(applyPlan(db("adminB"), m("L", "Curd")));
  });

  it("other clients' admins and revoked tills are refused", async () => {
    await addVendor();
    await assertFails(applyPlan(db("adminB"), buy("p1", {}, adminCtx("adminB"))));
    await assertSucceeds(applyPlan(db("super"), revokeTerminalPlan(adminCtx("super"), { id: "t1", authUid: "dev1", name: "Counter" }, "lost")));
    await assertFails(applyPlan(db("dev1"), buy("p2")));
  });

  it("nothing is ever deleted", async () => {
    await addVendor();
    await applyPlan(db("dev1"), buy("p1", { paidNow: { id: "pay1", amountPaise: 100, mode: "upi" } }));
    await applyPlan(db("dev1"), upsertMaterialPlan(termCtx(), { id: "milk", material: { name: "Milk", unit: "L", taxBps: 0, active: true } }));
    for (const path of ["clients/c1/vendors/v1", "clients/c1/materials/milk", "clients/c1/purchases/p1", "clients/c1/vendorPayments/pay1"]) await assertFails(deleteDoc(doc(db("super"), path)));
  });

  it("the largest vendor batch stays inside the rules budget", async () => {
    await addVendor();
    const big = buy("p1", {
      lines: [...lines, { lineId: "l2", materialId: "sugar", name: "Sugar", qtyMilli: 5000, unit: "kg", amountPaise: 21000, taxBps: 500 }, { lineId: "l3", materialId: "tea", name: "Tea", qtyMilli: 1000, unit: "kg", amountPaise: 52000, taxBps: 500 }],
      paidNow: { id: "pay1", amountPaise: 185000, mode: "drawer" },
      newMaterials: [
        { id: "sugar", material: { name: "Sugar", unit: "kg", taxBps: 500, active: true } },
        { id: "tea", material: { name: "Tea", unit: "kg", taxBps: 500, active: true } },
      ],
    });
    await assertSucceeds(applyPlan(db("dev1"), big));
  });
});
