import { describe, expect, it } from "vitest";
import { parseMenuImport, planMenuImport } from "../src/menu-import";
import type { PlanCtx } from "../src/plans/types";

let n = 0;
const newId = () => `id${++n}`;
const ctx: PlanCtx = { cid: "c1", nowMs: 1_760_000_000_000, actorId: "super", actorKind: "platform", source: "admin", newId };

const CSV = `Category,Item,Price,GST %,Station,Variants
Hot Drinks,Tea,25,5,Beverage,
Hot Drinks,Filter Coffee,₹ 30,5%,Beverage,
Cold Drinks,"Cold Milo, Malaysian",120,5,Beverage,
Coffee,Cappuccino,,5,Beverage,Regular:120|Large:150
Bun Butter Jam,Bun Maska,75,5,Kitchen,`;

describe("parseMenuImport", () => {
  it("reads CSV rows into paise, basis points, stations and variants", () => {
    const { rows, errors } = parseMenuImport(CSV);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.category, r.name, r.pricePaise, r.taxBps, r.station])).toEqual([
      ["Hot Drinks", "Tea", 2500, 500, "beverage"],
      ["Hot Drinks", "Filter Coffee", 3000, 500, "beverage"],
      ["Cold Drinks", "Cold Milo, Malaysian", 12000, 500, "beverage"],
      ["Coffee", "Cappuccino", 12000, 500, "beverage"],
      ["Bun Butter Jam", "Bun Maska", 7500, 500, "kitchen"],
    ]);
    expect(rows[3]!.variants).toEqual([
      { name: "Regular", pricePaise: 12000 },
      { name: "Large", pricePaise: 15000 },
    ]);
    expect(rows[0]!.foodType).toBe("veg");
  });

  it("accepts tab-separated text pasted from a spreadsheet", () => {
    const { rows, errors } = parseMenuImport("Item\tCategory\tRate\tGST\nMilk\tHot Drinks\t25\t5\n");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Milk", category: "Hot Drinks", pricePaise: 2500, taxBps: 500, station: "kitchen" });
  });

  it("explains bad rows by line number and keeps the good ones", () => {
    const { rows, errors } = parseMenuImport(`Category,Item,Price,GST %
Hot Drinks,Tea,25,12
Hot Drinks,Milk,abc,5
Hot Drinks,,25,5
Hot Drinks,Lemon Tea,25,5
hot drinks,lemon  tea,25,5`);
    expect(rows.map((r) => r.name)).toEqual(["Lemon Tea"]);
    expect(errors).toEqual([
      { line: 2, message: "Tea: GST must be 0, 5, 18 or 40" },
      { line: 3, message: 'Milk: price "abc" isn\'t a rupee amount' },
      { line: 4, message: "Item name is empty" },
      { line: 6, message: "lemon tea is listed twice in hot drinks" },
    ]);
  });

  it("needs a header row naming the columns", () => {
    expect(parseMenuImport("Tea,25,5").errors[0]!.message).toMatch(/Missing: Category, Item, GST %, Price/);
    expect(parseMenuImport("  \n").rows).toEqual([]);
  });
});

describe("planMenuImport", () => {
  it("creates missing categories, skips items already on the menu, and audits each item", () => {
    const { rows } = parseMenuImport(CSV);
    const s = planMenuImport(ctx, rows, { categories: [{ id: "hot", name: "hot drinks", sort: 3 }], items: [{ name: "TEA", categoryId: "hot", sort: 7 }], modes: ["dineIn", "quick"] }, newId);
    expect(s.skipped.map((r) => r.name)).toEqual(["Tea"]);
    expect(s.added.map((r) => r.name)).toEqual(["Filter Coffee", "Cold Milo, Malaysian", "Cappuccino", "Bun Maska"]);
    expect(s.newCategories).toEqual(["Cold Drinks", "Coffee", "Bun Butter Jam"]);
    expect(s.errors).toEqual([]);
    expect(s.plans).toHaveLength(1);

    const ops = s.plans[0]!.ops;
    const cats = ops.filter((o) => o.path.includes("/categories/"));
    expect(cats.map((o) => [o.data.name, o.data.sort, o.data.station])).toEqual([
      ["Cold Drinks", 4, "beverage"],
      ["Coffee", 5, "beverage"],
      ["Bun Butter Jam", 6, "kitchen"],
    ]);
    const items = ops.filter((o) => o.path.includes("/items/"));
    expect(items.map((o) => [o.data.name, o.data.sort, o.data.taxBps, o.data.modes])).toEqual([
      ["Filter Coffee", 8, 500, ["dineIn", "quick"]],
      ["Cold Milo, Malaysian", 9, 500, ["dineIn", "quick"]],
      ["Cappuccino", 10, 500, ["dineIn", "quick"]],
      ["Bun Maska", 11, 500, ["dineIn", "quick"]],
    ]);
    expect(items[0]!.data.categoryId).toBe("hot");
    expect(ops.filter((o) => o.path.includes("/auditLog/"))).toHaveLength(4);
  });

  it("splits large menus into batches under Firestore's write limit", () => {
    const lines = ["Category,Item,Price,GST"];
    for (let i = 1; i <= 450; i++) lines.push(`Menu,Item ${i},10,5`);
    const s = planMenuImport(ctx, parseMenuImport(lines.join("\n")).rows, { categories: [], items: [], modes: ["quick"] }, newId);
    expect(s.added).toHaveLength(450);
    expect(s.plans.length).toBe(3);
    for (const p of s.plans) expect(p.ops.length).toBeLessThanOrEqual(400);
    expect(s.plans.flatMap((p) => p.ops)).toHaveLength(1 + 450 * 2);
  });
});
