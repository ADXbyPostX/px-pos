import { describe, expect, it } from "vitest";
import { upiPayUri, validateVpa } from "../src/upi";
import { validateClient } from "../src/validate";

describe("UPI", () => {
  it("accepts real-looking UPI IDs and rejects the rest", () => {
    expect(validateVpa("tearoom@okicici")).toBeNull();
    expect(validateVpa("9876543210@ybl")).toBeNull();
    expect(validateVpa("tea.room-1@paytm")).toBeNull();
    expect(validateVpa("")).toMatch(/Enter/);
    expect(validateVpa("tearoom")).toMatch(/name@bank/);
    expect(validateVpa("tea room@okicici")).toMatch(/name@bank/);
    expect(validateVpa("@okicici")).toMatch(/name@bank/);
  });

  it("builds a pay link with the amount locked", () => {
    expect(upiPayUri({ vpa: "tearoom@okicici", payee: "Tea Room" }, 12500)).toBe("upi://pay?pa=tearoom%40okicici&pn=Tea%20Room&am=125&cu=INR");
    expect(upiPayUri({ vpa: " tearoom@okicici ", payee: "Tea Room" }, 12550, { note: "Token 7" })).toBe("upi://pay?pa=tearoom%40okicici&pn=Tea%20Room&am=125.50&cu=INR&tn=Token%207");
    expect(upiPayUri({ vpa: "a@b", payee: "Tea Room" }, 5)).toContain("am=0.05");
    // Short enough for a version-3 QR (53 bytes) on the customer display.
    const compact = upiPayUri({ vpa: "tearoom@okicici", payee: "Tea Room, Kodambakkam" }, 12500, { compact: true, note: "x" });
    expect(compact.length).toBeLessThanOrEqual(53);
    expect(compact).toBe("upi://pay?pa=tearoom@okicici&pn=TeaRoom&am=125&cu=INR");
  });

  it("is checked with the client settings when present", () => {
    const base = { name: "Tea Room", legalName: "Tea Room", address: "Chennai", stateCode: "33" };
    expect(validateClient({ ...base })).toBeNull();
    expect(validateClient({ ...base, upi: { vpa: "tearoom", payee: "Tea Room" } })).toMatch(/name@bank/);
    expect(validateClient({ ...base, upi: { vpa: "tearoom@okicici", payee: " " } })).toMatch(/name shown/);
    expect(validateClient({ ...base, upi: { vpa: "tearoom@okicici", payee: "Tea Room" } })).toBeNull();
  });
});
