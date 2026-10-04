import {
  addDays,
  bulkTablesPlan,
  computeBill,
  createClientPlan,
  expenseDelta,
  gstinCheckChar,
  paths,
  platformUserPlan,
  postingOps,
  sumDeltas,
  settleDelta,
  statsTree,
  upsertCategoryPlan,
  upsertFloorPlan,
  upsertItemPlan,
  upsertStaffPlan,
  zReport,
  EXPENSE_CATEGORIES,
  type BizDate,
  type Client,
  type DailyStats,
  type FoodType,
  type ItemInput,
  type OrderMode,
  type PayMode,
  type PlanCtx,
  type PlanOp,
  type StaffRole,
  type StatsDelta,
  type Station,
  type WritePlan,
} from "@px-pos/core";

/** Fixed id so verification scripts can find it. A fictional tea shop shaped like our first real client (Tea Room). */
export const DEMO_CID = "demo-tea-shop";
export const DEMO_NAME = "Demo Tea Shop";

// Syntactically valid (checksummed) but fictional GSTIN for Maharashtra.
const G14 = "27AAKFT4521M1Z";
export const DEMO_GSTIN = `${G14}${gstinCheckChar(G14)}`;

/**
 * `gst` is the item's own GST rate in bps, stored on the item at creation. Everything a
 * standalone tea room serves is restaurant service at 5% (GST 2.0); retail packs of tea
 * leaves are goods, also 5%. Rates are mock values — confirm the real menu with the accountant.
 */
type SeedItem = { name: string; short?: string; food: FoodType; price?: number; variants?: Array<[string, number]>; stock?: number; lowAt?: number; gst?: number; modes?: OrderMode[] };
const MENU: Array<{ name: string; station: Station; items: SeedItem[] }> = [
  {
    name: "Chai",
    station: "beverage",
    items: [
      { name: "Cutting Chai", food: "veg", price: 20 },
      { name: "Masala Chai", food: "veg", variants: [["Regular", 40], ["Large", 60]] },
      { name: "Adrak Chai", short: "Ginger Chai", food: "veg", variants: [["Regular", 40], ["Large", 60]] },
      { name: "Elaichi Chai", food: "veg", variants: [["Regular", 40], ["Large", 60]] },
      { name: "Kulhad Chai", food: "veg", price: 50 },
      { name: "Tandoori Chai", food: "veg", price: 70 },
      { name: "Kashmiri Kahwa", food: "veg", price: 90 },
      { name: "Chai Kettle (serves 4)", short: "Chai Kettle", food: "veg", price: 150, modes: ["dineIn", "delivery"] },
    ],
  },
  {
    name: "Tea",
    station: "beverage",
    items: [
      { name: "Assam Breakfast Tea", food: "veg", price: 90 },
      { name: "Darjeeling First Flush", short: "Darjeeling FF", food: "veg", price: 130 },
      { name: "Earl Grey", food: "veg", price: 110 },
      { name: "Green Tea", food: "veg", price: 80 },
      { name: "Lemon Honey Ginger", short: "Lemon Honey", food: "veg", price: 90 },
      { name: "Chamomile", food: "veg", price: 120 },
      { name: "Hibiscus Rose", food: "veg", price: 120 },
    ],
  },
  {
    name: "Coffee",
    station: "beverage",
    items: [
      { name: "Filter Coffee", food: "veg", price: 60 },
      { name: "Espresso", food: "veg", price: 90 },
      { name: "Americano", food: "veg", price: 120 },
      { name: "Cappuccino", food: "veg", variants: [["Regular", 140], ["Large", 170]] },
      { name: "Café Latte", short: "Latte", food: "veg", variants: [["Regular", 150], ["Large", 180]] },
      { name: "Hot Chocolate", food: "veg", price: 160 },
    ],
  },
  {
    name: "Coolers",
    station: "beverage",
    items: [
      { name: "Iced Lemon Tea", food: "veg", price: 110 },
      { name: "Peach Iced Tea", food: "veg", price: 130 },
      { name: "Cold Coffee", food: "veg", price: 150 },
      { name: "Masala Chaas", food: "veg", price: 60 },
      { name: "Fresh Lime Soda", food: "veg", variants: [["Sweet", 90], ["Salted", 90]] },
      { name: "Mineral Water (1 L)", short: "Water 1L", food: "veg", price: 20, stock: 48, lowAt: 12 },
    ],
  },
  {
    name: "Sandwiches",
    station: "kitchen",
    items: [
      { name: "Bombay Masala Sandwich", short: "Bombay Sandwich", food: "veg", variants: [["Plain", 90], ["Grilled", 120]] },
      { name: "Veg Cheese Grilled", food: "veg", price: 140 },
      { name: "Corn & Cheese Sandwich", short: "Corn Cheese", food: "veg", price: 150 },
      { name: "Paneer Tikka Sandwich", short: "Paneer Tikka Sand", food: "veg", price: 170 },
      { name: "Veg Club Sandwich", short: "Veg Club", food: "veg", price: 210 },
      { name: "Egg Mayo Sandwich", short: "Egg Mayo", food: "egg", price: 130 },
      { name: "Chicken Tikka Sandwich", short: "Chicken Tikka Sand", food: "nonveg", price: 190 },
    ],
  },
  {
    name: "Snacks",
    station: "kitchen",
    items: [
      { name: "Bun Maska", food: "veg", variants: [["Plain", 40], ["With Jam", 50]] },
      { name: "Vada Pav", food: "veg", price: 30 },
      { name: "Samosa (2 pcs)", short: "Samosa", food: "veg", price: 40, stock: 40, lowAt: 10 },
      { name: "Veg Puff", food: "veg", price: 35, stock: 24, lowAt: 6 },
      { name: "Kanda Poha", food: "veg", price: 60 },
      { name: "Masala Maggi", food: "veg", variants: [["Plain", 80], ["Cheese", 100]] },
      { name: "Chilli Cheese Toast", food: "veg", price: 120 },
      { name: "Masala Omelette", food: "egg", price: 90 },
      { name: "French Fries", food: "veg", variants: [["Salted", 110], ["Peri-Peri", 130]] },
    ],
  },
  {
    name: "Bakery",
    station: "beverage",
    items: [
      { name: "Osmania Biscuits (4 pcs)", short: "Osmania", food: "veg", price: 40, stock: 30, lowAt: 8 },
      { name: "Nankhatai (3 pcs)", short: "Nankhatai", food: "veg", price: 45, stock: 30, lowAt: 8 },
      { name: "Khari (4 pcs)", short: "Khari", food: "veg", price: 40, stock: 30, lowAt: 8 },
      { name: "Banana Walnut Cake", short: "Banana Cake", food: "egg", price: 90, stock: 16, lowAt: 4 },
      { name: "Chocolate Brownie", short: "Brownie", food: "egg", price: 110, stock: 12, lowAt: 4 },
      { name: "Butter Croissant", short: "Croissant", food: "veg", price: 120, stock: 10, lowAt: 3 },
      { name: "House Chai Blend (250 g)", short: "Chai Blend 250g", food: "veg", price: 280, stock: 20, lowAt: 5, modes: ["quick", "delivery"] },
    ],
  },
];

const STAFF: Array<[string, StaffRole, string]> = [
  ["Mandy", "manager", "9820011111"],
  ["Monishaaa JC", "owner", "9820022222"],
  ["Vadak 1", "cashier", "9820033333"],
  ["Vadak 2", "captain", "9820044444"],
  ["Vadak 3", "kitchen", "9820055555"],
];

/** Merge several plans into batches of at most `max` ops (plans with postings stay alone). */
function pack(plans: WritePlan[], max = 450): WritePlan[] {
  const out: WritePlan[] = [];
  let cur: PlanOp[] = [];
  const flush = () => {
    if (cur.length) out.push({ label: "Seed", ops: cur, primaryPath: cur[0]!.path });
    cur = [];
  };
  for (const p of plans) {
    if (p.postingKey) {
      flush();
      out.push(p);
      continue;
    }
    if (cur.length + p.ops.length > max) flush();
    cur.push(...p.ops);
  }
  flush();
  return out;
}

export interface SeedResult {
  plans: WritePlan[];
  demoAdminId: string;
}

/** Everything needed for a working mock outlet (menu, tables, staff, a demo admin). */
export function demoSeedPlans(ctxFor: (cid: string) => PlanCtx, ids: () => string, today: BizDate): SeedResult {
  const ctx = ctxFor(DEMO_CID);
  const demoAdminId = ids() + ids().slice(0, 8);
  const plans: WritePlan[] = [];
  plans.push(
    platformUserPlan({ uid: demoAdminId, role: "admin", name: "Demo Admin", email: "demo-admin@example.com", active: true, nowMs: ctx.nowMs, create: true }),
  );
  plans.push(
    createClientPlan(ctx, {
      name: DEMO_NAME,
      legalName: "Demo Tea Shop LLP",
      address: "Shop 4, Hill Road, Bandra West, Mumbai 400050",
      city: "Mumbai",
      stateName: "Maharashtra",
      stateCode: "27",
      phone: "9876543210",
      gstin: DEMO_GSTIN,
      fssai: "11524999000456",
      taxMode: "regular",
      defaultTaxBps: 500,
      // Menu boards at a tea room quote the price you pay: GST is backed out of it.
      priceMode: "inclusive",
      rounding: "rupee",
      invoicePrefix: "DT",
      adminUids: [demoAdminId],
      orderModes: { dineIn: true, quick: true, delivery: true },
      modeOpts: { dineIn: { askCovers: false, backToTables: true }, quick: { payFirst: true }, delivery: { defaultPrepaid: false } },
      charges: { packagingPaise: 1000, packagingOn: ["delivery"], deliveryPaise: 3000, serviceChargeBps: 0 },
      day: { cutoffMin: 180 },
      kds: { warnMin: 6, lateMin: 12 },
      receipt: { header: [], footer: ["Thank you! Come back for another cup.", "Instagram @thetearoom"], showSac: true },
    }),
  );
  let sort = 0;
  MENU.forEach((cat, ci) => {
    const catId = `cat${ci + 1}`;
    plans.push(upsertCategoryPlan(ctx, catId, { name: cat.name, sort: ci + 1, station: cat.station, active: true }, true));
    cat.items.forEach((it) => {
      sort += 1;
      const variants = (it.variants ?? []).map(([name, rupees], vi) => ({ id: `v${vi + 1}`, name, pricePaise: rupees * 100 }));
      const item: ItemInput = {
        name: it.name,
        ...(it.short ? { shortName: it.short } : {}),
        categoryId: catId,
        sort,
        foodType: it.food,
        pricePaise: variants.length ? Math.min(...variants.map((v) => v.pricePaise)) : (it.price ?? 0) * 100,
        variants,
        taxBps: it.gst ?? 500,
        modes: it.modes ?? ["dineIn", "quick", "delivery"],
        trackStock: it.stock != null,
        unit: it.stock != null ? "pcs" : cat.station === "beverage" ? "portion" : "plate",
        lowAt: it.lowAt ?? 0,
        available: true,
        active: true,
      };
      plans.push(upsertItemPlan(ctx, { id: `item${String(sort).padStart(2, "0")}`, item, ...(it.stock ? { openingQty: it.stock, businessDate: today } : {}) }));
    });
  });
  const floors: Array<[string, string, string, number, number, number]> = [
    ["fl1", "Inside", "T", 1, 8, 4],
    ["fl2", "Verandah", "V", 1, 4, 2],
  ];
  let tableSort = 0;
  floors.forEach(([id, name, prefix, from, to, seats], fi) => {
    plans.push(upsertFloorPlan(ctx, id, { name, sort: fi + 1, active: true }, true));
    const count = to - from + 1;
    plans.push(bulkTablesPlan(ctx, { floorId: id, prefix, from, to, seats, startSort: tableSort + 1, ids: Array.from({ length: count }, (_, k) => `${id}-${prefix}${from + k}`) }));
    tableSort += count;
  });
  STAFF.forEach(([name, role, phone], i) => plans.push(upsertStaffPlan(ctx, `staff${i + 1}`, { name, role, phone, active: true })));
  return { plans: pack(plans), demoAdminId };
}

/** Small deterministic PRNG (mulberry32) so demo history is repeatable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a tea room actually spends on (milk daily, tea/coffee stock, bakery, gas, cups). */
const TEA_ROOM_EXPENSES = EXPENSE_CATEGORIES.filter((c) => ["dairy", "raw_material", "beverages", "vegetables", "gas_fuel", "packaging"].includes(c));

export interface HistoryItem {
  id: string;
  categoryId: string;
  pricePaise: number;
  taxBps: number | null;
}

/**
 * `days` closed business days of synthetic sales ending yesterday: one posting + dailyStats
 * per day (so Reconcile balances), a closed day doc with its Z report, and a few expenses.
 * Orders/invoices themselves are not generated.
 */
export function demoHistoryPlans(ctx: PlanCtx, client: Client, items: HistoryItem[], staffIds: string[], today: BizDate, days = 30): WritePlan[] {
  const plans: WritePlan[] = [];
  const modes: OrderMode[] = ["dineIn", "quick", "delivery"];
  const pays: PayMode[] = ["cash", "upi", "card"];
  let zNo = client.lastZNo;
  for (let back = days; back >= 1; back--) {
    const date = addDays(today, -back);
    const rand = rng(Number(date.replace(/-/g, "")));
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    const orders = Math.floor((weekend ? 140 : 90) + rand() * 60);
    const deltas: StatsDelta[] = [];
    for (let o = 0; o < orders; o++) {
      // Tea room: mostly counter (quick), then tables, a little delivery; 1–3 items a ticket.
      const r = rand();
      const mode = modes[r < 0.55 ? 1 : r < 0.9 ? 0 : 2]!;
      const n = 1 + Math.floor(rand() * 3);
      const lines = Array.from({ length: n }, (_, k) => {
        const it = items[Math.floor(rand() * items.length)]!;
        return { lineId: `l${k}`, itemId: it.id, categoryId: it.categoryId, unitPricePaise: it.pricePaise, qty: 1 + Math.floor(rand() * 2), voidedQty: 0, taxBps: it.taxBps };
      });
      const bill = computeBill({ lines, serviceChargeOptIn: false, charges: client.charges, mode, client });
      const hour = 7 + Math.floor(rand() * 15); // 07:00–21:59
      const settledAtMs = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00+05:30`);
      const p = rand();
      const pay = pays[p < 0.62 ? 1 : p < 0.92 ? 0 : 2]!; // UPI-first, then cash, some card
      deltas.push(
        settleDelta({
          mode,
          ...(mode === "dineIn" ? { covers: 1 + Math.floor(rand() * 3) } : {}),
          lines: Object.fromEntries(lines.map((l) => [l.lineId, { itemId: l.itemId, categoryId: l.categoryId }])),
          bill,
          applied: [{ mode: pay, amountPaise: bill.grandTotalPaise }],
          tipPaise: 0,
          series: `${client.invoicePrefix}1`,
          settledAtMs,
          staffId: staffIds[Math.floor(rand() * staffIds.length)] ?? "staff1",
          terminalId: "demo-terminal",
        }),
      );
    }
    const expenseCount = 1 + Math.floor(rand() * 3);
    for (let e = 0; e < expenseCount; e++) {
      const category = TEA_ROOM_EXPENSES[Math.floor(rand() * TEA_ROOM_EXPENSES.length)]!;
      deltas.push(expenseDelta({ amountPaise: (300 + Math.floor(rand() * 2200)) * 100, category, paidVia: rand() < 0.6 ? "drawer" : "bank", drawerTerminalId: "demo-terminal" }));
    }
    const stats = sumDeltas(deltas);
    const key = `demo:${date}`;
    zNo += 1;
    const z = zReport({
      zNo,
      businessDate: date,
      closedAtMs: Date.parse(`${addDays(date, 1)}T00:30:00+05:30`),
      stats: statsTree(stats) as Partial<DailyStats>,
      drawers: [{ terminalId: "demo-terminal", openingFloatPaise: 200000 }],
      invoiceRanges: [],
    });
    plans.push({
      label: `Demo ${date}`,
      postingKey: key,
      primaryPath: paths.posting(ctx.cid, key),
      ops: [
        ...postingOps(ctx, { key, kind: "settle", businessDate: date, refId: "demo-history", stats }),
        { path: paths.day(ctx.cid, date), op: "set", data: { status: "closed", openedAtMs: Date.parse(`${date}T09:00:00+05:30`), openedBy: "staff2", closedAtMs: z.closedAtMs, closedBy: "staff2", zNo, z, updatedAtMs: ctx.nowMs } },
      ],
    });
  }
  plans.push({ label: "Demo Z counter", primaryPath: paths.client(ctx.cid), ops: [{ path: paths.client(ctx.cid), op: "update", data: { lastZNo: zNo, updatedAtMs: ctx.nowMs } }] });
  return plans;
}
