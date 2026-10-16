import { describe, expect, it } from "vitest";
import {
  consumption,
  costOfMicro,
  formatStock,
  inputUnitsFor,
  materialLevel,
  packOf,
  parseStockInput,
  recipeBook,
  recipeCost,
  recipeFor,
  snapshotMaterials,
  stockInputText,
  stockUnitOf,
  toStockMicro,
  usageReport,
  validateRecipe,
} from "../src/inventory";
import { kotPlan, quickPlan, invoiceLinesFor, voidLinePlan, cancelOrderPlan, type OrderRef } from "../src/plans/order";
import { closeDayPlan } from "../src/plans/ops";
import { materialMovePlan } from "../src/plans/inventory";
import { upsertItemPlan } from "../src/plans/admin";
import { purchasePlan, purchaseVoidPlan, upsertMaterialPlan } from "../src/plans/vendors";
import type { PlanCtx, WritePlan } from "../src/plans/types";
import { voidDelta, cancelBillDelta } from "../src/stats";
import { stockEod } from "../src/stock";
import { computeBill } from "../src/bill";
import { settleTenders } from "../src/tenders";
import { validateItem, validateMaterial } from "../src/validate";
import type { BillResult, Item, ItemRecipe, Material, OrderLine } from "../src/types";

let n = 0;
const ctx: PlanCtx = { cid: "demo", nowMs: Date.parse("2026-10-16T08:00:00Z"), actorId: "s1", actorKind: "staff", terminalId: "t1", source: "app", newId: () => `id${++n}` };
const admin: PlanCtx = { ...ctx, actorId: "boss", actorKind: "platform", source: "admin", terminalId: undefined };

const milk: Pick<Material, "unit" | "pack"> = { unit: "L" };
const sugar: Pick<Material, "unit" | "pack"> = { unit: "kg" };
const eggs: Pick<Material, "unit" | "pack"> = { unit: "tray", pack: 30 };

// Masala chai: Regular 80 ml milk + 8 g sugar; Large 120 ml milk + 12 g sugar.
const chai: ItemRecipe = {
  reg: [
    { materialId: "milk", qtyMicro: 80_000 },
    { materialId: "sugar", qtyMicro: 8_000 },
  ],
  lg: [
    { materialId: "milk", qtyMicro: 120_000 },
    { materialId: "sugar", qtyMicro: 12_000 },
  ],
};
const omelette: ItemRecipe = { _: [{ materialId: "eggs", qtyMicro: 2_000_000 }] };
const book = recipeBook([
  { id: "chai", recipe: chai },
  { id: "omelette", recipe: omelette },
  { id: "water", recipe: {} },
]);

const line = (id: string, itemId: string, qty: number, extra: Partial<OrderLine> = {}): OrderLine => ({
  lineId: id,
  seq: 1,
  itemId,
  name: itemId,
  categoryId: "c",
  station: "beverage",
  unitPricePaise: 3000,
  qty,
  taxBps: 500,
  sentQty: 0,
  voidedQty: 0,
  addedBy: "s1",
  addedAtMs: 0,
  ...extra,
});

const inventoryOp = (p: WritePlan) => p.ops.find((o) => o.path === "clients/demo/inventory/onHand");
const statsOp = (p: WritePlan) => p.ops.find((o) => o.path.includes("/dailyStats/"));

function expectExactlyOnce(p: WritePlan) {
  const postings = p.ops.filter((o) => o.path.includes("/postings/"));
  expect(postings).toHaveLength(1);
  expect(postings[0]?.path.endsWith(`/postings/${p.postingKey}`)).toBe(true);
  for (const op of p.ops.filter((o) => /\/(dailyStats|stock|inventory)\//.test(o.path))) expect(op.data.lastPostingKey).toBe(p.postingKey);
  expect(new Set(p.ops.map((o) => o.path)).size).toBe(p.ops.length);
}

describe("stock units", () => {
  it("keeps packs in pieces and everything else in its own unit", () => {
    expect(stockUnitOf(milk)).toBe("L");
    expect(stockUnitOf(eggs)).toBe("pcs");
    expect(packOf({ unit: "dozen" })).toBe(12);
    expect(stockUnitOf({ unit: "pkt" })).toBe("pkt"); // no size given
    expect(packOf({ unit: "kg", pack: 10 })).toBeNull(); // only packs have pieces
  });

  it("converts bill quantities to stock", () => {
    expect(toStockMicro(2000, "tray", eggs)).toBe(60_000_000); // 2 trays = 60 eggs
    expect(toStockMicro(2000, "L", milk)).toBe(2_000_000);
    expect(toStockMicro(250_000, "ml", milk)).toBe(250_000); // 250 ml into a material kept in L
    expect(toStockMicro(500_000, "g", sugar)).toBe(500_000); // 500 g = 0.5 kg
    expect(toStockMicro(1000, "dozen", { unit: "pcs" })).toBe(12_000_000);
    expect(toStockMicro(1000, "box", milk)).toBeNull();
  });

  it("parses and shows quantities", () => {
    const [ml, L] = inputUnitsFor(milk);
    expect(ml).toEqual({ unit: "ml", micro: 1000 });
    expect(parseStockInput("80", ml!)).toBe(80_000);
    expect(parseStockInput("1.5", L!)).toBe(1_500_000);
    expect(parseStockInput("0", L!)).toBe(0);
    expect(parseStockInput("abc", L!)).toBeNull();
    expect(parseStockInput("2.5", inputUnitsFor(sugar)[0]!)).toBe(2_500); // 2.5 g
    expect(stockInputText(80_000, ml!)).toBe("80");
    expect(formatStock(80_000, milk)).toBe("80 ml");
    expect(formatStock(2_350_000, sugar)).toBe("2.35 kg");
    expect(formatStock(2_500, sugar)).toBe("2.5 g");
    expect(formatStock(60_000_000, eggs)).toBe("60 pcs");
    expect(formatStock(-1_200_000, milk)).toBe("−1.2 L");
    expect(inputUnitsFor(eggs).map((u) => u.unit)).toEqual(["pcs", "tray"]);
  });

  it("levels: below zero asks for a count", () => {
    expect(materialLevel(-1, 5)).toBe("negative");
    expect(materialLevel(0, 5)).toBe("out");
    expect(materialLevel(5, 5)).toBe("low");
    expect(materialLevel(6, 5)).toBe("ok");
    expect(materialLevel(1, undefined)).toBe("ok");
  });
});

describe("formulas", () => {
  it("uses each size's own formula", () => {
    expect(recipeFor(chai, "lg")).toEqual(chai.lg);
    expect(recipeFor(omelette)).toEqual(omelette._);
    expect(book.has("water")).toBe(false);
    // 2 Large + 1 Regular chai and an omelette
    expect(
      consumption(
        [
          { itemId: "chai", variantId: "lg", qty: 2 },
          { itemId: "chai", variantId: "reg", qty: 1 },
          { itemId: "omelette", qty: 1 },
          { itemId: "water", qty: 3 },
        ],
        book,
      ),
    ).toEqual({ milk: 320_000, sugar: 32_000, eggs: 2_000_000 });
  });

  it("validates", () => {
    const sizes = [
      { id: "reg", name: "Regular" },
      { id: "lg", name: "Large" },
    ];
    expect(validateRecipe(chai, sizes)).toBeNull();
    expect(validateRecipe({ reg: chai.reg! }, sizes)).toBe("Add the formula for Large");
    expect(validateRecipe(chai, [])).toBe("The formula has a size the item no longer has");
    expect(validateRecipe({ _: [{ materialId: "m", qtyMicro: 1 }, { materialId: "m", qtyMicro: 2 }] }, [])).toBe("Each material only once per formula");
    expect(validateRecipe({ _: [{ materialId: "m", qtyMicro: 0 }] }, [])).toBe("Enter how much of each material goes in");
    expect(validateRecipe(omelette, [], true)).toMatch(/not both/);
    expect(validateRecipe({}, [])).toBeNull();
  });

  it("costs a serving at the last rates", () => {
    const mats = new Map<string, Pick<Material, "unit" | "pack">>([
      ["milk", milk],
      ["sugar", sugar],
      ["eggs", eggs],
    ]);
    const rates = new Map([
      ["milk", { ratePaise: 5600, unit: "L" as const }],
      ["sugar", { ratePaise: 46_000, unit: "g" as const }], // a rate per gram (₹460/g) on a material kept in kg
      ["eggs", { ratePaise: 18_000, unit: "tray" as const }],
    ]);
    expect(costOfMicro(80_000, 5600, milk)).toBe(448); // 80 ml at ₹56/L = ₹4.48
    expect(costOfMicro(1_000_000, 18_000, eggs)).toBe(600); // one egg from a ₹180 tray of 30
    const r = recipeCost(chai.reg!, mats, rates);
    expect(r.missing).toEqual([]);
    expect(r.costPaise).toBe(448 + 368_000); // 8 g at ₹460/g = ₹3,680: the g → kg conversion is applied
    expect(recipeCost([{ materialId: "tea", qtyMicro: 3000 }], mats, rates).missing).toEqual(["tea"]);
  });
});

const sale = { tracked: new Set<string>(), recipes: book };

describe("sales use up raw materials, exactly once", () => {
  it("KOT", () => {
    const p = kotPlan(ctx, {
      order: { create: { id: "o1", orderNo: "1-001", mode: "dineIn", businessDate: "2026-10-16", tableId: "t", tableLabel: "T1" } },
      lines: [line("a", "chai", 2, { variantId: "lg", variantName: "Large" }), line("b", "omelette", 1, { station: "kitchen" })],
      alloc: { numbers: [1, 2], terminalCode: "1" },
      ...sale,
    });
    expectExactlyOnce(p);
    expect(inventoryOp(p)?.op).toBe("merge");
    expect(inventoryOp(p)?.data.mat).toEqual({ milk: { $inc: -240_000 }, sugar: { $inc: -24_000 }, eggs: { $inc: -2_000_000 } });
    expect((statsOp(p)?.data.mat as Record<string, unknown>).milk).toEqual({ used: { $inc: 240_000 } });
    expect(p.ops.find((o) => o.path.includes("/postings/"))?.data.materials).toEqual({ milk: -240_000, sugar: -24_000, eggs: -2_000_000 });
  });

  it("a sale without formulas writes no inventory", () => {
    const p = kotPlan(ctx, {
      order: { create: { id: "o2", orderNo: "1-002", mode: "dineIn", businessDate: "2026-10-16", tableId: "t", tableLabel: "T1" } },
      lines: [line("a", "water", 1)],
      alloc: { numbers: [3], terminalCode: "1" },
      ...sale,
    });
    expect(inventoryOp(p)).toBeUndefined();
  });

  it("quick order", () => {
    const client = { taxMode: "regular" as const, rounding: "rupee" as const, defaultTaxBps: 500 };
    const lines = [line("a", "chai", 1, { variantId: "reg" })];
    const bill = computeBill({ lines: [{ lineId: "a", unitPricePaise: 3000, qty: 1, voidedQty: 0, taxBps: 500 }], serviceChargeOptIn: false, charges: { packagingPaise: 0, packagingOn: [], deliveryPaise: 0, serviceChargeBps: 0 }, mode: "quick", client });
    const t = settleTenders(bill.grandTotalPaise, 0, [{ mode: "cash", amountPaise: bill.grandTotalPaise }]);
    const p = quickPlan(ctx, {
      create: { id: "q1", orderNo: "1-003", mode: "quick", businessDate: "2026-10-16", token: 3 },
      lines,
      alloc: { numbers: [4], terminalCode: "1" },
      bill,
      invoiceLines: invoiceLinesFor(lines, bill),
      invoice: { series: "DC1", fy: "26-27", seq: 1, invoiceNo: "DC1/26-27/000001", invoiceId: "DC1-2627-000001", dateIST: "2026-10-16" },
      supplier: { legalName: "Demo", fssai: "12345678901234", address: "x", stateName: "Maharashtra", stateCode: "27" },
      docType: "tax_invoice",
      applied: t.ok ? t.applied : [],
      tipPaise: 0,
      ...sale,
    });
    expectExactlyOnce(p);
    expect(inventoryOp(p)?.data.mat).toEqual({ milk: { $inc: -80_000 }, sugar: { $inc: -8_000 } });
  });

  it("void: returned before it was made, wasted after (moved from used, stock unchanged)", () => {
    const back = voidDelta({ itemId: "chai", variantId: "lg", recipe: chai, qty: 1, amountPaise: 4000, reason: "r", prepared: false, staffId: "s1", tracked: false });
    expect(back.materials).toEqual({ milk: 120_000, sugar: 12_000 });
    expect((back.stats.mat as Record<string, unknown>).milk).toEqual({ rev: 120_000 });
    const waste = voidDelta({ itemId: "chai", variantId: "lg", recipe: chai, qty: 1, amountPaise: 4000, reason: "r", prepared: true, staffId: "s1", tracked: true });
    expect(waste.materials).toEqual({});
    expect((waste.stats.mat as Record<string, unknown>).milk).toEqual({ used: -120_000, waste: 120_000 });
    // Item stock: the prepared void is no longer counted twice (sold then wasted).
    expect((waste.stats.stock as Record<string, unknown>).chai).toEqual({ sold: -1, waste: 1 });
    expect(waste.stock).toEqual({});
    expect(stockEod(10, { sold: 1 - 1, waste: 1 })).toBe(9); // = 10 − the 1 the KOT took
  });

  it("line void and cancel plans carry the formulas", () => {
    const sent = line("a", "chai", 2, { variantId: "reg", sentQty: 2 });
    const o: OrderRef = { id: "o9", orderNo: "1-009", mode: "dineIn", businessDate: "2026-10-16", terminalId: "t1", kotCount: 1, status: "open", lines: { a: sent }, tableId: "t", tableLabel: "T1" };
    const v = voidLinePlan(ctx, { order: o, line: sent, qty: 1, reason: "Customer changed mind", prepared: false, alloc: { numbers: [9], terminalCode: "1" }, ...sale });
    expectExactlyOnce(v);
    expect(inventoryOp(v)?.data.mat).toEqual({ milk: { $inc: 80_000 }, sugar: { $inc: 8_000 } });
    const c = cancelOrderPlan(ctx, { order: o, reason: "x", prepared: false, ...sale });
    expect(inventoryOp(c)?.data.mat).toEqual({ milk: { $inc: 160_000 }, sugar: { $inc: 16_000 } });
    const cancelled = cancelBillDelta({ settled: false, bill: { grandTotalPaise: 0 } as BillResult, series: "", refunds: [], cancellingTerminalId: "t1", items: [{ itemId: "chai", variantId: "reg", qty: 2 }], tracked: new Set(), prepared: true, recipes: book });
    expect(cancelled.materials).toEqual({});
  });
});

describe("bills add stock", () => {
  const units = { milk, eggs };
  const bill = () =>
    purchasePlan(admin, {
      id: "b1",
      vendor: { id: "v1", name: "Lakshmi Dairy" },
      billDate: "2026-10-16",
      businessDate: "2026-10-16",
      lines: [
        { lineId: "l1", materialId: "milk", name: "Milk", qtyMilli: 20_000, unit: "L", amountPaise: 112_000, taxBps: 0 },
        { lineId: "l2", materialId: "eggs", name: "Eggs", qtyMilli: 2_000, unit: "tray", amountPaise: 36_000, taxBps: 0 },
        { lineId: "l3", name: "Ice", qtyMilli: 1_000, unit: "pcs", amountPaise: 2_000, taxBps: 0 },
      ],
      stockUnits: units,
      today: "2026-10-16",
    });

  it("records what each line added and moves it once", () => {
    const p = bill();
    expectExactlyOnce(p);
    const doc = p.ops.find((o) => o.path === "clients/demo/purchases/b1")?.data as { lines: Array<{ stockMicro?: number }> };
    expect(doc.lines.map((l) => l.stockMicro)).toEqual([20_000_000, 60_000_000, undefined]);
    expect(inventoryOp(p)?.data.mat).toEqual({ milk: { $inc: 20_000_000 }, eggs: { $inc: 60_000_000 } });
    expect((statsOp(p)?.data.mat as Record<string, unknown>).eggs).toEqual({ in: { $inc: 60_000_000 } });
  });

  it("a void takes back exactly what the bill added", () => {
    const doc = bill().ops.find((o) => o.path === "clients/demo/purchases/b1")?.data as unknown as Parameters<typeof purchaseVoidPlan>[1];
    const v = purchaseVoidPlan(admin, { ...doc, id: "b1" }, "Entered twice");
    expectExactlyOnce(v);
    expect(inventoryOp(v)?.data.mat).toEqual({ milk: { $inc: -20_000_000 }, eggs: { $inc: -60_000_000 } });
  });

  it("a bill without stock info adds none (older tills)", () => {
    const p = purchasePlan(admin, { id: "b2", vendor: { id: "v1", name: "x" }, billDate: "2026-10-16", businessDate: "2026-10-16", lines: [{ lineId: "l1", materialId: "milk", name: "Milk", qtyMilli: 1000, unit: "L", amountPaise: 5600, taxBps: 0 }], today: "2026-10-16" });
    expect(inventoryOp(p)).toBeUndefined();
  });
});

describe("counts, wastage, stock in", () => {
  it("a count adjusts by counted − book, in one posting", () => {
    const p = materialMovePlan(ctx, {
      id: "c1",
      businessDate: "2026-10-16",
      kind: "count",
      lines: [
        { materialId: "milk", name: "Milk", qty: 4_500_000, book: 5_000_000 },
        { materialId: "sugar", name: "Sugar", qty: 2_000_000, book: 2_000_000 },
      ],
    });
    expectExactlyOnce(p);
    expect(p.postingKey).toBe("mstk:c1");
    expect(inventoryOp(p)?.data.mat).toEqual({ milk: { $inc: -500_000 } });
    expect((statsOp(p)?.data.mat as Record<string, unknown>).milk).toEqual({ adj: { $inc: -500_000 } });
    expect(p.ops.find((o) => o.path.includes("/postings/"))?.data).toMatchObject({ kind: "material_count", lines: [{ materialId: "milk", qty: 4_500_000, book: 5_000_000 }, { materialId: "sugar" }] });
  });

  it("wastage and stock in", () => {
    const w = materialMovePlan(ctx, { id: "w1", businessDate: "2026-10-16", kind: "waste", lines: [{ materialId: "milk", name: "Milk", qty: 500_000 }], reason: "Curdled" });
    expect(inventoryOp(w)?.data.mat).toEqual({ milk: { $inc: -500_000 } });
    expect((statsOp(w)?.data.mat as Record<string, unknown>).milk).toEqual({ waste: { $inc: 500_000 } });
    const s = materialMovePlan(admin, { id: "s1", businessDate: "2026-10-16", kind: "in", lines: [{ materialId: "sugar", name: "Sugar", qty: 1_000_000 }] });
    expect(inventoryOp(s)?.data.mat).toEqual({ sugar: { $inc: 1_000_000 } });
  });

  it("refuses bad moves", () => {
    const bad = (i: Partial<Parameters<typeof materialMovePlan>[1]>) => () => materialMovePlan(ctx, { id: "x", businessDate: "2026-10-16", kind: "in", lines: [], ...i });
    expect(bad({})).toThrow("Add at least one material");
    expect(bad({ kind: "waste", lines: [{ materialId: "m", name: "Milk", qty: 1 }] })).toThrow("Say why");
    expect(bad({ kind: "count", lines: [{ materialId: "m", name: "Milk", qty: 1 }] })).toThrow("book stock is missing");
    expect(bad({ lines: [{ materialId: "m", name: "Milk", qty: 0 }] })).toThrow("enter how much");
  });
});

describe("the ledger", () => {
  it("day close snapshots raw materials", () => {
    const { plan } = closeDayPlan(ctx, {
      businessDate: "2026-10-16",
      lastZNo: 0,
      day: { status: "open" },
      stats: { mat: { milk: { in: 20_000_000, used: 1_000_000, rev: 0, waste: 500_000, adj: 0 } } },
      drawers: [],
      invoices: [],
      prevSnapshot: {},
      prevMaterials: { milk: 2_000_000 },
      counts: {},
    });
    expect(plan.ops.find((o) => o.path.endsWith("stockSnapshots/2026-10-16"))?.data.materials).toEqual({ milk: 20_500_000 });
    expect(snapshotMaterials({ a: 1 }, { b: { in: 2 } })).toEqual({ a: 1, b: 2 });
  });

  it("usage: works back from today's stock", () => {
    // Milk on hand now 5 L. 14th: bought 20 L, used 12 L. 15th: used 3 L, wasted 0.5 L. 16th (after the range): count −0.5 L.
    const rows = usageReport(
      { milk: 5_000_000 },
      [
        { id: "2026-10-14", mat: { milk: { in: 20_000_000, used: 12_000_000 } } },
        { id: "2026-10-15", mat: { milk: { used: 3_000_000, waste: 500_000 } } },
        { id: "2026-10-16", mat: { milk: { adj: -500_000 } } },
      ],
      "2026-10-14",
      "2026-10-15",
    );
    expect(rows).toEqual([{ materialId: "milk", opening: 1_000_000, in: 20_000_000, used: 15_000_000, rev: 0, waste: 500_000, adj: 0, closing: 5_500_000 }]);
  });
});

describe("items and materials", () => {
  const base = { name: "Masala Chai", categoryId: "c", foodType: "veg" as const, pricePaise: 3000, variants: [], taxBps: 500, modes: ["quick" as const], trackStock: false, unit: "portion" as const, lowAt: 0, available: true, active: true, sort: 1 };
  const before = { ...base, id: "chai", recipe: omelette, rev: 1, schemaVersion: 1 as const, createdAtMs: 1, updatedAtMs: 1, source: "admin" as const } as unknown as Item & { id: string };

  it("validateItem checks the formula", () => {
    expect(validateItem({ ...base, recipe: omelette })).toBeNull();
    expect(validateItem({ ...base, recipe: omelette, trackStock: true })).toMatch(/not both/);
  });

  it("removing a formula deletes it and is audited as a formula change", () => {
    const p = upsertItemPlan(admin, { id: "chai", item: { ...base, recipe: {} }, before });
    const upd = p.ops.find((o) => o.path === "clients/demo/items/chai");
    expect(upd?.data.recipe).toEqual({ $delete: true });
    expect(p.ops.find((o) => o.path.includes("/auditLog/"))?.data).toMatchObject({ action: "item.recipe" });
    const created = upsertItemPlan(admin, { id: "tea", item: { ...base, recipe: {} } });
    expect(created.ops[0]?.data).not.toHaveProperty("recipe");
    // A price edit or a menu import passes no recipe key: the formula stays.
    const repriced = upsertItemPlan(admin, { id: "chai", item: { ...base, pricePaise: 3500 }, before });
    expect(repriced.ops[0]?.data).not.toHaveProperty("recipe");
  });

  it("pieces per pack only on packs, and only changed while there's no stock", () => {
    expect(validateMaterial({ name: "Eggs", unit: "tray", taxBps: 0, pack: 30 })).toBeNull();
    expect(validateMaterial({ name: "Milk", unit: "L", taxBps: 0, pack: 30 })).toMatch(/Only packs/);
    expect(validateMaterial({ name: "Eggs", unit: "tray", taxBps: 0, pack: 1 })).toMatch(/2 to 1000/);
    const eggsDoc = { name: "Eggs", unit: "tray" as const, taxBps: 0, active: true, id: "eggs", schemaVersion: 1 as const, createdAtMs: 1, updatedAtMs: 1, source: "admin" as const } as unknown as Material & { id: string };
    expect(() => upsertMaterialPlan(admin, { id: "eggs", material: { ...eggsDoc, pack: 30 }, before: eggsDoc, onHand: 5_000_000 })).toThrow(/no stock/);
    const ok = upsertMaterialPlan(admin, { id: "eggs", material: { ...eggsDoc, pack: 30 }, before: eggsDoc, onHand: 0 });
    expect(ok.ops[0]?.data).toMatchObject({ pack: 30 });
    const resize = upsertMaterialPlan(admin, { id: "eggs", material: { ...eggsDoc, pack: 24 }, before: { ...eggsDoc, pack: 30 }, onHand: 9_000_000 });
    expect(resize.ops[0]?.data).toMatchObject({ pack: 24 });
  });
});
