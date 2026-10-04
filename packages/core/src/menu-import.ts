import { parseINR } from "./money";
import { upsertCategoryPlan, upsertItemPlan, type ItemInput } from "./plans/admin";
import type { PlanCtx, PlanOp, WritePlan } from "./plans/types";
import type { Bps, FoodType, OrderMode, Paise, Station } from "./types";
import { TAX_RATES, validateItem } from "./validate";

/**
 * Menu import: a pasted table (CSV, or tab-separated straight from a spreadsheet) →
 * categories + items. One row per item; the header row names the columns:
 *
 *   Category, Item, Price, GST %, Station, Type, Variants
 *   Hot Drinks, Tea, 25, 5, Beverage, Veg,
 *   Coffee, Cappuccino, , 5, Beverage, Veg, Regular:120|Large:150
 *
 * Category, Item and GST % are required; Price is required unless every variant has one.
 * Station (kitchen / bar / beverage) applies only to categories this import creates.
 * Variants are `Name` or `Name:Price`, separated by `|`; a variant without a price uses the
 * row's Price.
 */
export interface MenuImportRow {
  line: number;
  category: string;
  name: string;
  pricePaise: Paise;
  taxBps: Bps;
  station: Station;
  foodType: FoodType;
  variants: Array<{ name: string; pricePaise: Paise }>;
}

export interface MenuImportParse {
  rows: MenuImportRow[];
  errors: Array<{ line: number; message: string }>;
}

const COLUMNS = {
  category: ["category", "section", "group"],
  name: ["item", "name", "item name"],
  price: ["price", "rate", "mrp", "price (rs)", "price (₹)"],
  gst: ["gst", "gst %", "gst%", "tax", "tax %", "gst rate"],
  station: ["station", "made at", "counter"],
  type: ["type", "food type", "veg", "veg/non-veg"],
  variants: ["variants", "sizes", "options"],
} as const;
type Col = keyof typeof COLUMNS;

const STATION: Record<string, Station> = { kitchen: "kitchen", bar: "bar", beverage: "beverage", "beverage counter": "beverage", counter: "beverage", drinks: "beverage" };
const FOOD: Record<string, FoodType> = { veg: "veg", "non-veg": "nonveg", nonveg: "nonveg", "non veg": "nonveg", egg: "egg" };

/** Split one CSV/TSV line, honouring "quoted, fields" and "" escapes. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function parseGst(raw: string): Bps | null {
  const s = raw.replace(/%/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return (TAX_RATES as readonly number[]).includes(bps) ? bps : null;
}

export function parseMenuImport(text: string): MenuImportParse {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const errors: MenuImportParse["errors"] = [];
  const rows: MenuImportRow[] = [];
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) return { rows, errors };

  const sep = lines[first]!.includes("\t") ? "\t" : ",";
  const header = splitLine(lines[first]!, sep).map(norm);
  const at = {} as Record<Col, number>;
  for (const col of Object.keys(COLUMNS) as Col[]) at[col] = header.findIndex((h) => (COLUMNS[col] as readonly string[]).includes(h));
  const missing = [at.category < 0 && "Category", at.name < 0 && "Item", at.gst < 0 && "GST %", at.price < 0 && at.variants < 0 && "Price"].filter(Boolean);
  if (missing.length) {
    errors.push({ line: first + 1, message: `The first row must name the columns. Missing: ${missing.join(", ")}` });
    return { rows, errors };
  }

  const seen = new Set<string>();
  for (let i = first + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "") continue;
    const cells = splitLine(lines[i]!, sep);
    const cell = (c: Col) => (at[c] >= 0 ? (cells[at[c]] ?? "").trim() : "");
    const line = i + 1;
    const bad = (message: string) => errors.push({ line, message });

    const category = cell("category").replace(/\s+/g, " ");
    const name = cell("name").replace(/\s+/g, " ");
    if (!category) {
      bad("Category is empty");
      continue;
    }
    if (!name) {
      bad("Item name is empty");
      continue;
    }
    const key = `${norm(category)}/${norm(name)}`;
    if (seen.has(key)) {
      bad(`${name} is listed twice in ${category}`);
      continue;
    }
    seen.add(key);

    const priceRaw = cell("price");
    const price = priceRaw ? parseINR(priceRaw) : null;
    if (priceRaw && price == null) {
      bad(`${name}: price "${priceRaw}" isn't a rupee amount`);
      continue;
    }
    const taxBps = parseGst(cell("gst"));
    if (taxBps == null) {
      bad(`${name}: GST must be 0, 5, 18 or 40`);
      continue;
    }
    const stationRaw = norm(cell("station"));
    const station = stationRaw ? STATION[stationRaw] : "kitchen";
    if (!station) {
      bad(`${name}: station must be Kitchen, Bar or Beverage`);
      continue;
    }
    const typeRaw = norm(cell("type"));
    const foodType = typeRaw ? FOOD[typeRaw] : "veg";
    if (!foodType) {
      bad(`${name}: type must be Veg, Non-veg or Egg`);
      continue;
    }

    const variants: MenuImportRow["variants"] = [];
    let variantError: string | null = null;
    for (const part of cell("variants").split("|").map((p) => p.trim()).filter(Boolean)) {
      const m = /^(.*?)\s*[:=]\s*([^:=]+)$/.exec(part);
      const vName = (m ? m[1]! : part).trim();
      const vPrice = m ? parseINR(m[2]!) : price;
      if (!vName || vPrice == null || vPrice <= 0) {
        variantError = `${name}: variant "${part}" needs a name and a price`;
        break;
      }
      variants.push({ name: vName, pricePaise: vPrice });
    }
    if (variantError) {
      bad(variantError);
      continue;
    }
    const base = variants.length ? Math.min(...variants.map((v) => v.pricePaise)) : price;
    if (base == null || base <= 0) {
      bad(`${name}: price is missing`);
      continue;
    }
    rows.push({ line, category, name, pricePaise: base, taxBps, station, foodType, variants });
  }
  return { rows, errors };
}

export interface MenuImportSummary {
  plans: WritePlan[];
  newCategories: string[];
  added: MenuImportRow[];
  /** Already on the menu (same name in the same category): left untouched. */
  skipped: MenuImportRow[];
  errors: Array<{ line: number; message: string }>;
}

/**
 * Plans for the rows not already on the menu. Batches stay well under Firestore's
 * 500-write limit. Items get the client's enabled order modes and no stock tracking.
 */
export function planMenuImport(
  ctx: PlanCtx,
  rows: MenuImportRow[],
  existing: { categories: Array<{ id: string; name: string; sort: number }>; items: Array<{ name: string; categoryId: string; sort: number }>; modes: OrderMode[] },
  newId: (len?: number) => string,
): MenuImportSummary {
  const catByName = new Map(existing.categories.map((c) => [norm(c.name), c.id]));
  const have = new Set(existing.items.map((i) => `${i.categoryId}/${norm(i.name)}`));
  let catSort = Math.max(0, ...existing.categories.map((c) => c.sort));
  let itemSort = Math.max(0, ...existing.items.map((i) => i.sort));

  const ops: PlanOp[] = [];
  const newCategories: string[] = [];
  const added: MenuImportRow[] = [];
  const skipped: MenuImportRow[] = [];
  const errors: MenuImportSummary["errors"] = [];

  for (const r of rows) {
    let categoryId = catByName.get(norm(r.category));
    if (categoryId && have.has(`${categoryId}/${norm(r.name)}`)) {
      skipped.push(r);
      continue;
    }
    const item: ItemInput = {
      name: r.name,
      categoryId: categoryId ?? "pending",
      sort: itemSort + 1,
      foodType: r.foodType,
      pricePaise: r.pricePaise,
      variants: r.variants.map((v) => ({ id: newId(6), ...v })),
      taxBps: r.taxBps,
      modes: existing.modes,
      trackStock: false,
      unit: "pcs",
      lowAt: 0,
      available: true,
      active: true,
    };
    const err = validateItem(item);
    if (err) {
      errors.push({ line: r.line, message: `${r.name}: ${err}` });
      continue;
    }
    if (!categoryId) {
      categoryId = newId();
      catByName.set(norm(r.category), categoryId);
      newCategories.push(r.category);
      ops.push(...upsertCategoryPlan(ctx, categoryId, { name: r.category, sort: ++catSort, station: r.station, active: true }, true).ops);
    }
    itemSort++;
    have.add(`${categoryId}/${norm(r.name)}`);
    ops.push(...upsertItemPlan(ctx, { id: newId(), item: { ...item, categoryId } }).ops);
    added.push(r);
  }

  const plans: WritePlan[] = [];
  for (let i = 0; i < ops.length; i += 400) {
    const chunk = ops.slice(i, i + 400);
    plans.push({ label: `Import menu (${plans.length + 1})`, ops: chunk, primaryPath: chunk[0]!.path });
  }
  return { plans, newCategories, added, skipped, errors };
}
