import { describe, expect, it } from "vitest";
import { computeBill } from "../src/bill";
import { decodeBase64, encodeBase64, logoRows, validateReceiptLogo } from "../src/logo";
import { updateClientPlan } from "../src/plans/admin";
import { restartNumberingPlan } from "../src/plans/platform";
import type { PlanCtx } from "../src/plans/types";
import { renderInvoice, renderKot, receiptText, type InvoicePrint } from "../src/receipt";
import type { Client, ReceiptLogo } from "../src/types";

const logoOf = (w: number, h: number): ReceiptLogo => ({ w, h, data: encodeBase64(new Uint8Array((w / 8) * h).map((_, i) => i % 256)) });

describe("base64", () => {
  it("matches RFC 4648 and round-trips every length", () => {
    const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    for (const [plain, b64] of [["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"], ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"]] as const) {
      expect(encodeBase64(ascii(plain))).toBe(b64);
      expect(decodeBase64(b64)).toEqual(ascii(plain));
    }
    for (let n = 0; n < 12; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 200) % 256);
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
  });
  it("rejects what isn't base64", () => {
    for (const bad of ["abc", "ab=c", "a b=", "@@@@"]) expect(decodeBase64(bad)).toBeNull();
  });
});

describe("receipt logo", () => {
  it("validates size and data", () => {
    expect(validateReceiptLogo(logoOf(384, 200))).toBeNull();
    expect(validateReceiptLogo(logoOf(8, 1))).toBeNull();
    expect(validateReceiptLogo(logoOf(392, 10))).toMatch(/wide/);
    expect(validateReceiptLogo({ w: 100, h: 10, data: "" })).toMatch(/wide/);
    expect(validateReceiptLogo(logoOf(64, 201))).toMatch(/tall/);
    expect(validateReceiptLogo({ ...logoOf(64, 10), h: 11 })).toMatch(/damaged/);
    expect(validateReceiptLogo(undefined)).toMatch(/missing/);
    expect(logoRows({ w: 16, h: 1, data: encodeBase64(new Uint8Array([0xff, 0x01])) })).toEqual(new Uint8Array([0xff, 0x01]));
    expect(logoRows({ w: 16, h: 2, data: "AAAA" })).toBeNull();
  });

  const bill = computeBill({ lines: [{ lineId: "a", unitPricePaise: 2500, qty: 1, voidedQty: 0, taxBps: 500 }], serviceChargeOptIn: false, charges: { packagingPaise: 0, packagingOn: [], deliveryPaise: 0, serviceChargeBps: 0 }, mode: "quick", client: { taxMode: "regular", rounding: "rupee", defaultTaxBps: 500 } });
  const print: InvoicePrint = {
    invoiceNo: "1/26-27/000001",
    issuedAtMs: Date.parse("2026-10-05T08:35:00Z"),
    orderNo: "1-001",
    mode: "quick",
    where: "Token 1",
    docType: "tax_invoice",
    supplier: { legalName: "Tea Room", fssai: "", address: "Kodambakkam, Chennai", stateName: "Tamil Nadu", stateCode: "33" },
    lines: [{ lineId: "a", name: "Tea", qty: 1, unitPricePaise: 2500, amountPaise: 2500, taxBps: 500 }],
    bill,
  };

  it("replaces the name at the top of bills; never in text or on KOTs", () => {
    const logo = logoOf(256, 64);
    const plain = renderInvoice(print, { header: [], footer: [], showSac: false }, { copy: "ORIGINAL", cols: 32 });
    const lines = renderInvoice(print, { header: [], footer: [], showSac: false, logo }, { copy: "ORIGINAL", cols: 32 });
    expect(lines[0]).toEqual({ kind: "image", logo });
    expect(lines[1]).toEqual({ kind: "feed", lines: 1 }); // a gap before the address
    expect(lines.filter((l) => l.kind === "image")).toHaveLength(1);
    expect(lines.slice(2)).toEqual(plain.slice(1)); // the name goes; address and the rest stay
    expect(plain[0]).toMatchObject({ kind: "text", text: "Tea Room" });
    expect(receiptText(lines, 32)).not.toContain("Tea Room");
    const kot = renderKot({ kotNo: "1-0001", kind: "new", mode: "quick", where: "Token 1", station: "beverage", items: [{ lineId: "a", name: "Tea", qty: 1 }], atMs: 0 } as never, { cols: 32 });
    expect(kot.some((l) => l.kind === "image")).toBe(false);
  });

  it("switched off, the name prints like before", () => {
    const lines = renderInvoice(print, { header: [], footer: [], showSac: false, logo: logoOf(256, 64), showLogo: false }, { copy: "ORIGINAL", cols: 32 });
    expect(lines).toEqual(renderInvoice(print, { header: [], footer: [], showSac: false }, { copy: "ORIGINAL", cols: 32 }));
  });

  it("a damaged logo is skipped and the name prints instead", () => {
    const lines = renderInvoice(print, { header: [], footer: [], showSac: false, logo: { w: 64, h: 10, data: "AAAA" } }, { copy: "ORIGINAL", cols: 32 });
    expect(lines.some((l) => l.kind === "image")).toBe(false);
    expect(lines[0]).toMatchObject({ kind: "text", text: "Tea Room" });
  });

  it("settings audit keeps the logo's size, not its pixels", () => {
    const ctx: PlanCtx = { cid: "tr", nowMs: 1, actorId: "boss", actorKind: "platform", source: "admin", newId: () => "a1" };
    const logo = logoOf(384, 120);
    const before = { name: "Tea Room", receipt: { header: [], footer: [], showSac: true } } as unknown as Client;
    const p = updateClientPlan(ctx, before, { receipt: { header: [], footer: [], showSac: true, logo } });
    expect((p.ops[0]?.data.receipt as Client["receipt"]).logo).toEqual(logo);
    const audit = p.ops.find((o) => o.path.includes("/auditLog/"));
    expect(JSON.stringify(audit?.data)).not.toContain(logo.data);
    expect(((audit?.data.after as Record<string, unknown>).receipt as Record<string, unknown>).logo).toBe("384x120 dots");
  });
});

describe("restart numbering", () => {
  it("zeroes the terminal's numbers for this FY and audits what they were", () => {
    const ctx: PlanCtx = { cid: "tr", nowMs: Date.parse("2026-10-05T10:00:00Z"), actorId: "boss", actorKind: "platform", source: "admin", newId: () => "a1" };
    const p = restartNumberingPlan(ctx, { id: "t1", name: "Counter 1", series: "1", lastInvoiceSeq: 14, lastInvoiceFy: "26-27" });
    expect(p.ops[0]).toMatchObject({ path: "clients/tr/terminals/t1", op: "update", data: { lastInvoiceSeq: 0, lastInvoiceFy: "26-27", lastKot: { d: "", n: 0 }, lastToken: { d: "", n: 0 }, countersResetAtMs: ctx.nowMs } });
    expect(p.ops[1]?.data).toMatchObject({ action: "terminal.restartNumbering", before: { lastInvoiceSeq: 14 } });
  });
});
