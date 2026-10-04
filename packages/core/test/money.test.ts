import { describe, expect, it } from "vitest";
import { allocate, divRound, formatINR, formatINRCompact, groupIN, mulDivRound, parseINR, roundToRupee } from "../src/money";

describe("divRound / mulDivRound", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(7, 2)).toBe(4);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(1, 3)).toBe(0);
    expect(divRound(0, 7)).toBe(0);
  });
  it("computes GST halves exactly", () => {
    expect(mulDivRound(30000, 500, 20000)).toBe(750);
    expect(mulDivRound(20700, 500, 20000)).toBe(518); // 517.5 → 518
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
  });
  it("uses the BigInt path when the product leaves the safe range", () => {
    expect(mulDivRound(2 ** 40, 2 ** 20, 2 ** 20)).toBe(2 ** 40);
    expect(mulDivRound(Number.MAX_SAFE_INTEGER, 3, 3)).toBe(Number.MAX_SAFE_INTEGER);
    expect(mulDivRound(2 ** 50, 3, 2)).toBe(3 * 2 ** 49);
  });
  it("rejects non-integers and division by zero", () => {
    expect(() => mulDivRound(1.5, 2, 3)).toThrow();
    expect(() => mulDivRound(1, 2, 0)).toThrow();
  });
});

describe("allocate", () => {
  it("always sums exactly to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [3333, 3333, 3334])).toEqual([333, 333, 334]);
    expect(allocate(2300, [18000, 5000])).toEqual([1800, 500]);
  });
  it("spreads evenly over all-zero weights", () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
    expect(allocate(7, [0, 0, 0])).toEqual([3, 2, 2]);
  });
  it("handles zero, single and negative totals", () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(99, [7])).toEqual([99]);
    expect(allocate(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
  });
  it("breaks ties towards the lower index", () => {
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
  });
  it("is exact for many random splits", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    for (let n = 0; n < 500; n++) {
      const weights = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => Math.floor(rand() * 100000));
      const total = Math.floor(rand() * 1_000_000);
      const out = allocate(total, weights);
      expect(out.reduce((s, v) => s + v, 0)).toBe(total);
      expect(out.every((v) => v >= 0)).toBe(true);
    }
  });
});

describe("formatINR", () => {
  it("groups the Indian way", () => {
    expect(groupIN("1234567")).toBe("12,34,567");
    expect(groupIN("100")).toBe("100");
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR(5)).toBe("₹0.05");
    expect(formatINR(99)).toBe("₹0.99");
    expect(formatINR(100000)).toBe("₹1,000.00");
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(formatINR(1e10)).toBe("₹10,00,00,000.00");
  });
  it("handles negatives, symbols and decimals modes", () => {
    expect(formatINR(-500)).toBe("-₹5.00");
    expect(formatINR(12345678, { decimals: 0 })).toBe("₹1,23,457");
    expect(formatINR(10000, { decimals: "auto" })).toBe("₹100");
    expect(formatINR(10050, { decimals: "auto" })).toBe("₹100.50");
    expect(formatINR(150, { symbol: false })).toBe("1.50");
    expect(formatINR(150, { signed: true })).toBe("+₹1.50");
  });
  it("formats compact values", () => {
    expect(formatINRCompact(123456)).toBe("₹1.23K");
    expect(formatINRCompact(1_200_000_000)).toBe("₹1.2Cr");
    expect(formatINRCompact(120_000_000)).toBe("₹12L");
    expect(formatINRCompact(99900)).toBe("₹999");
  });
});

describe("parseINR", () => {
  it("parses user input into paise", () => {
    expect(parseINR("120.50")).toBe(12050);
    expect(parseINR("120")).toBe(12000);
    expect(parseINR("120.5")).toBe(12050);
    expect(parseINR("1,20,000")).toBe(12000000);
    expect(parseINR("₹ 99")).toBe(9900);
    expect(parseINR(".5")).toBe(50);
  });
  it("rejects junk", () => {
    for (const bad of ["1.234", "abc", "1e3", "-5", "", "1.2.3", "12a"]) expect(parseINR(bad)).toBeNull();
  });
});

describe("roundToRupee", () => {
  it("rounds half up to the rupee", () => {
    expect(roundToRupee(12350)).toBe(12400);
    expect(roundToRupee(12349)).toBe(12300);
    expect(roundToRupee(12300)).toBe(12300);
  });
});
