import { describe, expect, it } from "vitest";
import { cleanRecipients, eodFileNames, eodMailSubject, eodMailSummary, validateEmail } from "../src/eod-mail";
import { zReport } from "../src/stats";

describe("end-of-day email", () => {
  it("checks and cleans the list", () => {
    expect(validateEmail("owner@tearoom.in")).toBeNull();
    expect(validateEmail(" Owner@TeaRoom.in ")).toBeNull();
    expect(validateEmail("owner@tearoom")).toMatch(/doesn't look like/);
    expect(validateEmail("")).toMatch(/Enter/);
    expect(cleanRecipients([" A@x.in", "a@x.in", "bad", "b@y.co"])).toEqual(["a@x.in", "b@y.co"]);
    expect(cleanRecipients(Array.from({ length: 12 }, (_, i) => `p${i}@x.in`))).toHaveLength(10);
  });

  it("names the email and attachments, and heads it with the day's figures", () => {
    const z = zReport({ zNo: 49, businessDate: "2026-11-23", closedAtMs: 1, stats: { orders: 377, totalPaise: 2835700, byPay: { upi: 2006200, cash: 829500 } }, drawers: [], invoiceRanges: [] });
    expect(eodMailSubject("Tea Room", z)).toBe("Tea Room · End of day Mon 23 Nov 2026 · Z 49");
    expect(eodFileNames(z)).toEqual({ z: "Z-49-2026-11-23.pdf", items: "Items-2026-11-23.pdf" });
    expect(eodMailSummary(z)).toEqual([
      ["Total billed", "₹28,357.00"],
      ["Orders", "377"],
      ["Average order", "₹75.22"],
      ["UPI", "₹20,062.00"],
      ["Cash", "₹8,295.00"],
    ]);
  });
});
