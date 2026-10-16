import { mulDivRound } from "./money";
import type { BizDate, InventoryDoc, Item, ItemRecipe, Material, MaterialStats, MaterialUnit, Paise, RecipeLine } from "./types";
import { RECIPE_BASE } from "./types";
import { MATERIAL_UNIT_LABEL } from "./vendors";

/**
 * Raw-material inventory. Stock is kept in integer millionths ("micro") of each material's stock
 * unit — 80 ml of milk tracked in L is 80 000, 2.5 g of tea powder in kg is 2 500 — so formulas,
 * bills and counts add up exactly. A material sold in packs with a known size ("1 tray = 30 pcs",
 * and a dozen is always 12) is stocked in pieces; everything else in its own unit.
 */

export const MICRO = 1_000_000;

/** Units that come in packs of pieces (a dozen is always 12). */
export const PACK_UNITS: readonly MaterialUnit[] = ["pkt", "box", "tray", "bottle", "can", "cylinder"];

export const canHavePack = (unit: MaterialUnit) => PACK_UNITS.includes(unit);

/** Pieces in one purchase unit, or null when the material isn't stocked in pieces that way. */
export function packOf(m: Pick<Material, "unit" | "pack">): number | null {
  if (m.unit === "dozen") return 12;
  if (m.pack && canHavePack(m.unit)) return m.pack;
  return null;
}

/** The unit stock, formulas and counts are kept in. */
export function stockUnitOf(m: Pick<Material, "unit" | "pack">): MaterialUnit {
  return packOf(m) ? "pcs" : m.unit;
}

/** Same-dimension units, in their smallest unit (g, ml). */
const DIM: Partial<Record<MaterialUnit, { dim: "mass" | "volume"; small: number }>> = {
  kg: { dim: "mass", small: 1000 },
  g: { dim: "mass", small: 1 },
  L: { dim: "volume", small: 1000 },
  ml: { dim: "volume", small: 1 },
};

/**
 * A bill line's quantity (thousandths of `unit`) in micro of the material's stock unit:
 * 2 trays of eggs (30 pcs each) → 60 pcs; 500 g bought for a material kept in kg → 0.5 kg.
 * Null when the units don't convert (e.g. a "box" line for a material kept in L).
 */
export function toStockMicro(qtyMilli: number, unit: MaterialUnit, m: Pick<Material, "unit" | "pack">): number | null {
  if (!Number.isSafeInteger(qtyMilli)) return null;
  const su = stockUnitOf(m);
  const pack = packOf(m);
  let micro: number | null = null;
  if (unit === m.unit) micro = qtyMilli * 1000 * (pack ?? 1);
  else if (unit === "pcs" && su === "pcs") micro = qtyMilli * 1000;
  else if (unit === "dozen" && su === "pcs") micro = qtyMilli * 1000 * 12;
  else {
    const a = DIM[unit];
    const b = DIM[su];
    if (a && b && a.dim === b.dim) micro = mulDivRound(qtyMilli * 1000, a.small, b.small);
  }
  return micro != null && Number.isSafeInteger(micro) ? micro : null;
}

export interface InputUnit {
  unit: MaterialUnit;
  /** Micro of the stock unit in one of these. */
  micro: number;
}

/** Units a person may type a quantity in (formula: the small one first; counts: any). */
export function inputUnitsFor(m: Pick<Material, "unit" | "pack">): InputUnit[] {
  const su = stockUnitOf(m);
  const pack = packOf(m);
  if (su === "kg") return [{ unit: "g", micro: 1000 }, { unit: "kg", micro: MICRO }];
  if (su === "L") return [{ unit: "ml", micro: 1000 }, { unit: "L", micro: MICRO }];
  if (su === "g") return [{ unit: "g", micro: MICRO }, { unit: "kg", micro: 1000 * MICRO }];
  if (su === "ml") return [{ unit: "ml", micro: MICRO }, { unit: "L", micro: 1000 * MICRO }];
  if (su === "pcs" && pack) return [{ unit: "pcs", micro: MICRO }, { unit: m.unit, micro: pack * MICRO }];
  return [{ unit: su, micro: MICRO }];
}

/** "80" in ml for milk kept in L → 80 000. Up to 3 decimals; null when it isn't a number (zero allowed). */
export function parseStockInput(text: string, input: InputUnit): number | null {
  const s = text.trim();
  const m = /^(\d*)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  const milli = Number(m[1] || "0") * 1000 + Number((m[2] ?? "").padEnd(3, "0") || "0");
  if (!Number.isSafeInteger(milli)) return null;
  const micro = mulDivRound(milli, input.micro, 1000);
  return Number.isSafeInteger(micro) && micro <= 1e15 ? micro : null;
}

/** Micro → text in `input`'s unit without the unit ("80", "1.5"); for prefilling inputs. */
export function stockInputText(micro: number, input: InputUnit): string {
  return trimDecimal(micro, input.micro, 3);
}

function trimDecimal(value: number, per: number, maxDecimals: number): string {
  const neg = value < 0;
  const scale = 10 ** maxDecimals;
  const scaled = mulDivRound(Math.abs(value), scale, per);
  const whole = Math.trunc(scaled / scale);
  const frac = String(scaled % scale)
    .padStart(maxDecimals, "0")
    .replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : String(whole);
  return neg && out !== "0" ? `−${out}` : out;
}

const label = (u: MaterialUnit) => MATERIAL_UNIT_LABEL[u] ?? u;

/** "2.35 kg", "350 g", "80 ml", "12 pcs", "−1.2 L". Below one kg/L it switches to g/ml. */
export function formatStock(micro: number, m: Pick<Material, "unit" | "pack">): string {
  const su = stockUnitOf(m);
  const abs = Math.abs(micro);
  if ((su === "kg" || su === "L") && abs < MICRO) return `${trimDecimal(micro, 1000, 1)} ${su === "kg" ? "g" : "ml"}`;
  return `${trimDecimal(micro, MICRO, 2)} ${label(su)}`;
}

// ─── formulas ───────────────────────────────────────────────────────────────

/** item id → its formula, for every item that has one. */
export type RecipeBook = ReadonlyMap<string, ItemRecipe>;

export function hasRecipe(item: Pick<Item, "recipe"> | null | undefined): boolean {
  return Boolean(item?.recipe && Object.values(item.recipe).some((l) => l.length > 0));
}

/** The formula used for one sold: the size's own, else the item's base one. */
export function recipeFor(recipe: ItemRecipe | undefined, variantId?: string): RecipeLine[] {
  if (!recipe) return [];
  if (variantId && recipe[variantId]) return recipe[variantId]!;
  return recipe[RECIPE_BASE] ?? [];
}

export function recipeBook(items: Array<Pick<Item, "recipe"> & { id: string }>): Map<string, ItemRecipe> {
  return new Map(items.filter(hasRecipe).map((i) => [i.id, i.recipe as ItemRecipe]));
}

/** Raw materials a set of sold lines uses up (positive micro per material). */
export function consumption(lines: Array<{ itemId: string; variantId?: string; qty: number }>, book: RecipeBook | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!book) return out;
  for (const l of lines) {
    if (l.qty <= 0) continue;
    for (const r of recipeFor(book.get(l.itemId), l.variantId)) {
      if (r.qtyMicro > 0) out[r.materialId] = (out[r.materialId] ?? 0) + r.qtyMicro * l.qty;
    }
  }
  return out;
}

/** Every material an item's formula uses (any size). */
export function recipeMaterialIds(recipe: ItemRecipe | undefined): string[] {
  return [...new Set(Object.values(recipe ?? {}).flatMap((ls) => ls.map((l) => l.materialId)))];
}

/** A formula's problems, or null. `variants` = the item's sizes ([] = one price). */
export function validateRecipe(recipe: ItemRecipe | undefined, variants: Array<{ id: string; name: string }>, trackStock?: boolean): string | null {
  if (!recipe) return null;
  const keys = Object.keys(recipe).filter((k) => (recipe[k] ?? []).length > 0);
  if (!keys.length) return null;
  if (trackStock) return "An item is either counted in pieces or made from a formula, not both";
  const wanted = variants.length ? variants.map((v) => ({ key: v.id, name: v.name })) : [{ key: RECIPE_BASE, name: "" }];
  for (const k of keys) if (!wanted.some((w) => w.key === k)) return "The formula has a size the item no longer has";
  for (const w of wanted) {
    const lines = recipe[w.key] ?? [];
    if (!lines.length) return w.name ? `Add the formula for ${w.name}` : "Add at least one material to the formula";
    if (lines.length > 30) return "A formula can have at most 30 materials";
    const ids = new Set<string>();
    for (const l of lines) {
      if (!l.materialId) return "Pick a material on every formula line";
      if (ids.has(l.materialId)) return "Each material only once per formula";
      ids.add(l.materialId);
      if (!Number.isSafeInteger(l.qtyMicro) || l.qtyMicro <= 0 || l.qtyMicro > 1e12) return "Enter how much of each material goes in";
    }
  }
  return null;
}

// ─── costing ────────────────────────────────────────────────────────────────

/**
 * What `micro` of a material costs at a rate per its purchase unit (₹/kg, ₹/tray): pieces cost the
 * pack rate ÷ pieces per pack. Paise, rounded.
 */
export function costOfMicro(micro: number, ratePaise: Paise, m: Pick<Material, "unit" | "pack">): Paise {
  return mulDivRound(micro, ratePaise, MICRO * (packOf(m) ?? 1));
}

/** A rate per `unit` (from a bill line) as a rate per the material's own unit, or null. */
export function rateInMaterialUnit(ratePaise: Paise, unit: MaterialUnit, m: Pick<Material, "unit">): Paise | null {
  if (unit === m.unit) return ratePaise;
  const a = DIM[unit];
  const b = DIM[m.unit];
  if (a && b && a.dim === b.dim) return mulDivRound(ratePaise, b.small, a.small);
  return null;
}

/** Cost of one serving at the last rates paid; `missing` = materials never bought yet. */
export function recipeCost(
  lines: RecipeLine[],
  materials: ReadonlyMap<string, Pick<Material, "unit" | "pack">>,
  rates: ReadonlyMap<string, { ratePaise: Paise; unit: MaterialUnit }>,
): { costPaise: Paise; missing: string[] } {
  let cost = 0;
  const missing: string[] = [];
  for (const l of lines) {
    const m = materials.get(l.materialId);
    const r = rates.get(l.materialId);
    const rate = m && r ? rateInMaterialUnit(r.ratePaise, r.unit, m) : null;
    if (!m || rate == null) {
      missing.push(l.materialId);
      continue;
    }
    cost += costOfMicro(l.qtyMicro, rate, m);
  }
  return { costPaise: cost, missing };
}

// ─── stock levels and the ledger ────────────────────────────────────────────

export type MaterialLevel = "ok" | "low" | "out" | "negative";

/** Below zero means book stock went past what was there: count it. */
export function materialLevel(onHand: number | undefined, lowAt?: number): MaterialLevel {
  const q = typeof onHand === "number" && Number.isFinite(onHand) ? onHand : 0;
  if (q < 0) return "negative";
  if (q === 0) return "out";
  if (lowAt && lowAt > 0 && q <= lowAt) return "low";
  return "ok";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function materialStats(v: unknown): MaterialStats {
  const o = (v ?? {}) as Partial<MaterialStats>;
  return { in: num(o.in), used: num(o.used), rev: num(o.rev), waste: num(o.waste), adj: num(o.adj) };
}

/** A day's net change: in − used + returned − wasted ± adjusted. */
export function materialNet(s: Partial<MaterialStats> | undefined): number {
  const x = materialStats(s);
  return x.in - x.used + x.rev - x.waste + x.adj;
}

export function inventoryOnHand(doc: Partial<InventoryDoc> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(doc?.mat ?? {})) out[k] = num(v);
  return out;
}

/** Next snapshot from the ledger: snapshot[D] = snapshot[D−1] + net[D]. */
export function snapshotMaterials(prev: Record<string, number>, day: Record<string, Partial<MaterialStats>> | undefined): Record<string, number> {
  const out: Record<string, number> = { ...prev };
  for (const [id, s] of Object.entries(day ?? {})) out[id] = (out[id] ?? 0) + materialNet(s);
  return out;
}

export interface UsageRow extends MaterialStats {
  materialId: string;
  opening: number;
  closing: number;
}

/**
 * Opening → bought → used → wasted → count difference → closing per material over [from, to],
 * worked back from today's stock: closing(to) = on hand now − every movement after `to`.
 * `days` must hold every day from `from` up to today (missing days = nothing moved).
 */
export function usageReport(onHand: Record<string, number>, days: Array<{ id: BizDate; mat?: Record<string, Partial<MaterialStats>> }>, from: BizDate, to: BizDate): UsageRow[] {
  const ids = new Set(Object.keys(onHand));
  for (const d of days) for (const id of Object.keys(d.mat ?? {})) ids.add(id);
  const rows: UsageRow[] = [];
  for (const id of ids) {
    let after = 0;
    const sum: MaterialStats = { in: 0, used: 0, rev: 0, waste: 0, adj: 0 };
    for (const d of days) {
      const s = d.mat?.[id];
      if (!s || d.id < from) continue;
      if (d.id > to) after += materialNet(s);
      else {
        const x = materialStats(s);
        sum.in += x.in;
        sum.used += x.used;
        sum.rev += x.rev;
        sum.waste += x.waste;
        sum.adj += x.adj;
      }
    }
    const closing = (onHand[id] ?? 0) - after;
    const opening = closing - materialNet(sum);
    if (!opening && !closing && !sum.in && !sum.used && !sum.rev && !sum.waste && !sum.adj) continue;
    rows.push({ materialId: id, opening, ...sum, closing });
  }
  return rows;
}
