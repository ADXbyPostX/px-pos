import { describe, expect, it } from "vitest";
import { quickCash, settleTenders, tenderStatus } from "../src/tenders";
import { diffKot, kotKind, orderWhere, pendingQty, voidableQty, activeQty } from "../src/kot";
import { addDays, businessDateFor, daysBetween, fyFor, hourKey, istDate, isBizDate, istDateTimeLabel, rangeDates } from "../src/time";
import type { OrderLine } from "../src/types";

describe("settleTenders", () => {
  it("accepts an exact split", () => {
    const r = settleTenders(21000, 0, [
      { mode: "upi", amountPaise: 10000 },
      { mode: "cash", amountPaise: 11000 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changePaise).toBe(0);
  });
  it("gives change from cash only (the M4 verification: ₹210, UPI 100 + cash 200 → change 90)", () => {
    const r = settleTenders(21000, 0, [
      { mode: "upi", amountPaise: 10000 },
      { mode: "cash", amountPaise: 20000 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changePaise).toBe(9000);
      expect(r.applied).toEqual([
        { mode: "upi", amountPaise: 10000 },
        { mode: "cash", amountPaise: 11000, tenderedPaise: 20000, changePaise: 9000 },
      ]);
    }
  });
  it("lets a card cover a tip", () => {
    const r = settleTenders(10000, 500, [{ mode: "card", amountPaise: 10500 }]);
    expect(r.ok).toBe(true);
  });
  it("rejects a card over-tender without a tip", () => {
    const r = settleTenders(10000, 0, [{ mode: "card", amountPaise: 10500 }]);
    expect(r).toMatchObject({ ok: false, error: "OVERPAY_NONCASH" });
  });
  it("reports the shortfall", () => {
    const r = settleTenders(10000, 0, [{ mode: "cash", amountPaise: 5000 }]);
    expect(r).toMatchObject({ ok: false, error: "SHORT", remainingPaise: 5000 });
  });
  it("needs a tender unless nothing is due", () => {
    expect(settleTenders(10000, 0, [])).toMatchObject({ ok: false, error: "EMPTY" });
    expect(settleTenders(0, 0, []).ok).toBe(true);
  });
  it("live status for the pay panel", () => {
    expect(tenderStatus(21000, 0, [{ mode: "cash", amountPaise: 5000 }])).toMatchObject({ remainingPaise: 16000, changePaise: 0 });
    expect(tenderStatus(21000, 0, [{ mode: "cash", amountPaise: 50000 }])).toMatchObject({ remainingPaise: 0, changePaise: 29000 });
  });
  it("offers sensible quick-cash amounts", () => {
    expect(quickCash(21000)).toEqual([21000, 30000, 50000, 200000]);
    expect(quickCash(10000)).toEqual([10000, 50000, 200000]);
    expect(quickCash(0)).toEqual([]);
  });
});

const L = (id: string, station: OrderLine["station"], qty: number, sentQty: number, seq: number, extra: Partial<OrderLine> = {}): OrderLine => ({
  lineId: id,
  seq,
  itemId: `i-${id}`,
  name: `Item ${id}`,
  categoryId: "c1",
  station,
  unitPricePaise: 10000,
  qty,
  taxBps: null,
  sentQty,
  voidedQty: 0,
  addedBy: "s1",
  addedAtMs: 0,
  ...extra,
});

describe("KOT diffing", () => {
  it("groups unsent units per station in a stable order", () => {
    const groups = diffKot([L("b", "bar", 1, 0, 2), L("a", "kitchen", 2, 0, 1), L("c", "kitchen", 3, 3, 3)]);
    expect(groups.map((g) => g.station)).toEqual(["kitchen", "bar"]);
    expect(groups[0]?.items).toEqual([{ lineId: "a", itemId: "i-a", name: "Item a", qty: 2 }]);
  });
  it("sends only the new units on an add-on", () => {
    const groups = diffKot([L("a", "kitchen", 3, 2, 1, { note: "less spicy" })]);
    expect(groups[0]?.items[0]).toMatchObject({ qty: 1, note: "less spicy" });
  });
  it("returns nothing when all is sent", () => {
    expect(diffKot([L("a", "kitchen", 2, 2, 1)])).toEqual([]);
  });
  it("tracks pending, active and voidable units", () => {
    const l = L("a", "kitchen", 5, 4, 1, { voidedQty: 1 });
    expect(pendingQty(l)).toBe(1);
    expect(activeQty(l)).toBe(4);
    expect(voidableQty(l)).toBe(3);
  });
  it("kind and where", () => {
    expect(kotKind({ kotCount: 0 })).toBe("new");
    expect(kotKind({ kotCount: 2 })).toBe("addon");
    expect(orderWhere("dineIn", { tableLabel: "T4" })).toBe("T4");
    expect(orderWhere("quick", { token: 17 })).toBe("Token 17");
    expect(orderWhere("quick", { token: 3, customer: { name: "Ravi" } })).toBe("Token 3 - Ravi");
    expect(orderWhere("quick", {})).toBe("Quick");
    expect(orderWhere("quick", { customer: { name: "Ravi" } })).toBe("Ravi");
    expect(orderWhere("delivery", { customer: { name: "Ravi" } })).toBe("DLV Ravi");
    expect(orderWhere("delivery", { customer: { phone: "9876543210" } })).toBe("DLV …3210");
  });
});

// 2026-09-29 00:00 IST = 2026-09-28T18:30:00Z
const IST = (iso: string) => Date.parse(iso);

describe("IST time", () => {
  it("computes the IST calendar date", () => {
    expect(istDate(IST("2026-09-28T18:30:00Z"))).toBe("2026-09-29");
    expect(istDate(IST("2026-09-28T18:29:59Z"))).toBe("2026-09-28");
    expect(hourKey(IST("2026-09-29T08:35:00Z"))).toBe("14");
    expect(istDateTimeLabel(IST("2026-09-29T08:35:00Z"))).toBe("29 Sep 2026, 14:05");
  });
  it("business date honours the 04:00 cutoff", () => {
    expect(businessDateFor(IST("2026-09-28T20:00:00Z"), 240)).toBe("2026-09-28"); // 01:30 IST
    expect(businessDateFor(IST("2026-09-28T22:29:00Z"), 240)).toBe("2026-09-28"); // 03:59 IST
    expect(businessDateFor(IST("2026-09-28T22:30:00Z"), 240)).toBe("2026-09-29"); // 04:00 IST
    expect(businessDateFor(IST("2026-12-31T20:00:00Z"), 240)).toBe("2026-12-31"); // 01:30 IST on 1 Jan
  });
  it("financial year flips on 1 April IST", () => {
    expect(fyFor(IST("2027-03-31T18:29:00Z"))).toBe("26-27"); // 31 Mar 23:59 IST
    expect(fyFor(IST("2027-03-31T18:30:00Z"))).toBe("27-28"); // 1 Apr 00:00 IST
    expect(fyFor(IST("2099-06-01T00:00:00Z"))).toBe("99-00");
  });
  it("date arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(rangeDates("2026-09-28", "2026-10-01")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(rangeDates("2026-10-01", "2026-09-28")).toEqual([]);
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(29);
    expect(isBizDate("2026-02-30")).toBe(false);
    expect(isBizDate("2026-02-28")).toBe(true);
  });
});
