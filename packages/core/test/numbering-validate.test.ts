import { describe, expect, it } from "vitest";
import {
  findGaps,
  formatInvoiceNo,
  formatKotNo,
  formatOrderNo,
  invoiceDocId,
  isPairingCode,
  makeClientId,
  makeId,
  makeLineId,
  nextTerminalCode,
  normalizePairingCode,
  pairingCode,
  parseInvoiceNo,
  seriesFor,
  slugify,
} from "../src/numbering";
import { gstinCheckChar, validateBillBuyer, validateClient, validateExpense, validateFssai, validateGstin, validateItem } from "../src/validate";
import { phone10 } from "../src/paths";

describe("invoice numbering", () => {
  it("formats GST-compliant numbers of at most 16 chars", () => {
    const no = formatInvoiceNo("DC1", "26-27", 123);
    expect(no).toBe("DC1/26-27/000123");
    expect(no.length).toBe(16);
    expect(formatInvoiceNo("1", "26-27", 1)).toBe("1/26-27/000001");
    expect(formatInvoiceNo("DC1", "26-27", 999999)).toBe("DC1/26-27/999999");
  });
  it("rejects bad series and sequences", () => {
    expect(() => formatInvoiceNo("ABCD", "26-27", 1)).toThrow();
    expect(() => formatInvoiceNo("dc1", "26-27", 1)).toThrow();
    expect(() => formatInvoiceNo("DC1", "26-27", 0)).toThrow();
    expect(() => formatInvoiceNo("DC1", "26-27", 1_000_000)).toThrow();
    expect(() => seriesFor("ABC", "1")).toThrow();
    expect(seriesFor("DC", "1")).toBe("DC1");
    expect(seriesFor("", "A")).toBe("A");
  });
  it("round-trips doc ids and parsing", () => {
    expect(invoiceDocId("DC1", "26-27", 123)).toBe("DC1-2627-000123");
    expect(parseInvoiceNo("DC1/26-27/000123")).toEqual({ series: "DC1", fy: "26-27", seq: 123 });
    expect(parseInvoiceNo("junk")).toBeNull();
  });
  it("order, KOT and terminal codes", () => {
    expect(formatOrderNo("1", 42)).toBe("1-042");
    expect(formatKotNo("1", 17)).toBe("1-17");
    expect(nextTerminalCode(["1", "2"])).toBe("3");
    expect(nextTerminalCode([])).toBe("1");
  });
  it("finds gaps in a series", () => {
    expect(findGaps([1, 2, 4, 7])).toEqual([3, 5, 6]);
    expect(findGaps([5, 6, 8], 1)).toEqual([1, 2, 3, 4, 7]);
    expect(findGaps([])).toEqual([]);
  });
});

describe("pairing codes and ids", () => {
  it("uses Crockford base32", () => {
    const code = pairingCode([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(code).toBe("PXP-0123-4567");
    expect(isPairingCode(code)).toBe(true);
    expect(isPairingCode(pairingCode([31, 30, 29, 28, 27, 26, 25, 24]))).toBe(true);
    expect(isPairingCode("PXP-ILOU-1234")).toBe(false);
  });
  it("normalizes typed codes", () => {
    expect(normalizePairingCode("pxp 0123 4567")).toBe("PXP-0123-4567");
    expect(normalizePairingCode("pxp-o123-4567")).toBe("PXP-0123-4567");
  });
  it("makes ids", () => {
    let i = 0;
    const rand = () => ((i++ % 62) + 0.5) / 62;
    expect(makeId(rand, 5)).toBe("ABCDE");
    expect(makeLineId(() => 0.5)).toMatch(/^l[A-Za-z0-9]{11}$/);
    expect(slugify("Demo Café & Bar")).toBe("demo-cafe-bar");
    expect(makeClientId("Demo Café", () => 0)).toBe("demo-cafe-aaaa");
  });
  it("normalizes Indian mobile numbers", () => {
    expect(phone10("+91 98765-43210")).toBe("9876543210");
    expect(phone10("09876543210")).toBe("9876543210");
    expect(phone10("12345")).toBeNull();
    expect(phone10("5876543210")).toBeNull();
  });
});

describe("GSTIN / FSSAI", () => {
  it("accepts real GSTINs (check digit verified)", () => {
    expect(validateGstin("27AAPFU0939F1ZV")).toBeNull();
    expect(validateGstin("29AAGCB7383J1Z4")).toBeNull();
    expect(validateGstin("24AAACC1206D1ZM")).toBeNull();
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });
  it("rejects bad GSTINs", () => {
    expect(validateGstin("27AAPFU0939F1ZA")).toMatch(/check digit/);
    expect(validateGstin("27AAPFU0939F1Z")).toMatch(/15/);
    expect(validateGstin("")).toMatch(/required/);
    expect(validateGstin("00AAPFU0939F1ZV")).toMatch(/state|check/);
  });
  it("FSSAI is 14 digits", () => {
    expect(validateFssai("12345678901234")).toBeNull();
    expect(validateFssai("1234")).toMatch(/14/);
  });
});

describe("validators", () => {
  const item = { name: "Masala Chai", categoryId: "c1", pricePaise: 4000, taxBps: 500, modes: ["dineIn" as const], variants: [], lowAt: 0 };
  it("items", () => {
    expect(validateItem(item)).toBeNull();
    expect(validateItem({ ...item, name: " " })).toMatch(/name/);
    expect(validateItem({ ...item, pricePaise: 0 })).toMatch(/more than/);
    expect(validateItem({ ...item, modes: [] })).toMatch(/mode/);
    expect(validateItem({ ...item, taxBps: 700 })).toMatch(/GST rate/);
    expect(validateItem({ ...item, taxBps: null })).toMatch(/GST rate/);
    expect(validateItem({ ...item, taxBps: 1200 })).toMatch(/GST rate/); // pre-GST 2.0 slab
    expect(validateItem({ ...item, taxBps: 4000 })).toBeNull();
    expect(validateItem({ ...item, variants: [{ id: "r", name: "Regular", pricePaise: 4000 }, { id: "l", name: "regular", pricePaise: 6000 }] })).toMatch(/unique/);
  });
  it("clients", () => {
    const c = { name: "Demo", legalName: "Demo Pvt Ltd", address: "1 Road", stateCode: "27", fssai: "12345678901234", taxMode: "regular" as const, gstin: "27AAPFU0939F1ZV" };
    expect(validateClient(c)).toBeNull();
    expect(validateClient({ ...c, stateCode: "33" })).toMatch(/match/);
    expect(validateClient({ ...c, gstin: undefined })).toBeNull(); // GSTIN added later
    expect(validateClient({ ...c, taxMode: "composition", gstin: undefined })).toBeNull();
    expect(validateClient({ ...c, invoicePrefix: "ABC" })).toMatch(/prefix/);
    expect(validateClient({ ...c, fssai: "" })).toBeNull();
    expect(validateClient({ ...c, fssai: "1234" })).toMatch(/14/);
  });
  it("expenses", () => {
    expect(validateExpense({ amountPaise: 50000, category: "vegetables", paidVia: "drawer", drawerTerminalId: "t1" })).toBeNull();
    expect(validateExpense({ amountPaise: 50000, category: "vegetables", paidVia: "drawer" })).toMatch(/terminal/);
    expect(validateExpense({ amountPaise: 0, category: "vegetables", paidVia: "bank" })).toMatch(/amount/);
  });
  it("buyer details for large or B2B bills (Rule 46)", () => {
    expect(validateBillBuyer(4_999_900, undefined, "regular")).toBeNull();
    expect(validateBillBuyer(5_000_000, undefined, "regular")).toMatch(/50,000/);
    expect(validateBillBuyer(5_000_000, { name: "A", address: "B", stateCode: "27" }, "regular")).toBeNull();
    expect(validateBillBuyer(1000, { gstin: "27AAPFU0939F1ZV" }, "regular")).toMatch(/name/);
    expect(validateBillBuyer(1000, { gstin: "27AAPFU0939F1ZV", name: "Acme" }, "regular")).toBeNull();
    expect(validateBillBuyer(1000, { gstin: "BAD" }, "regular")).toMatch(/GSTIN/);
  });
});
