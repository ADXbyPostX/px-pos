import { describe, expect, it } from "vitest";
import { kitchenOn, printsKots } from "../src/kot";
import { adminStaffId, formatPinHash, parsePinHash, sameHash, validatePin } from "../src/pin";
import { adminTillPlan, assignAdminsPlan, deleteAdminPlan, upsertStaffPlan, type AdminPerson } from "../src/plans/admin";
import { kotPlan } from "../src/plans/order";
import type { PlanCtx } from "../src/plans/types";
import type { OrderLine } from "../src/types";

let n = 0;
const ctxFor = (cid: string): PlanCtx => ({ cid, nowMs: 1_000, actorId: "boss", actorKind: "platform", source: "admin", newId: () => `id${++n}` });
const HASH = formatPinHash({ iterations: 50_000, length: 4, salt: "c2FsdHNhbHRzYWx0c2FsdA==", hash: "aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=" });

describe("validatePin", () => {
  it("takes 4–6 digits", () => {
    for (const ok of ["2580", "73914", "908172"]) expect(validatePin(ok)).toBeNull();
    for (const bad of ["", "123", "1234567", "12a4", " 2580", "25.0"]) expect(validatePin(bad)).toMatch(/4 to 6 digits/);
  });
  it("refuses the obvious ones", () => {
    for (const weak of ["0000", "111111", "1234", "3456", "123456", "9876", "43210"]) expect(validatePin(weak)).not.toBeNull();
  });
});

describe("pin hash string", () => {
  it("round-trips", () => {
    expect(parsePinHash(HASH)).toEqual({ iterations: 50_000, length: 4, salt: "c2FsdHNhbHRzYWx0c2FsdA==", hash: "aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=" });
  });
  it("rejects anything else", () => {
    for (const bad of [undefined, "", "1234", "sha1$1$4$a$b", "pbkdf2-sha256$0$4$a$b", "pbkdf2-sha256$5$9$a$b", "pbkdf2-sha256$5$4$$b", `${HASH}$x`]) expect(parsePinHash(bad)).toBeNull();
  });
  it("compares fully", () => {
    expect(sameHash("abcd", "abcd")).toBe(true);
    expect(sameHash("abcd", "abce")).toBe(false);
    expect(sameHash("abcd", "abc")).toBe(false);
  });
});

describe("staff PIN plan", () => {
  it("audits a PIN change without the hash", () => {
    const p = upsertStaffPlan(ctxFor("tr"), "s1", { name: "Monisha", role: "owner", active: true, pinHash: HASH }, { name: "Monisha", role: "owner", active: true } as never);
    expect(p.ops[0]?.data.pinHash).toBe(HASH);
    const audit = p.ops.find((o) => o.path.includes("/auditLog/"));
    expect(JSON.stringify(audit?.data)).not.toContain(HASH);
    expect((audit?.data.after as Record<string, unknown>).pin).toBe("set");
  });
  it("leaves the PIN alone when none is given", () => {
    const p = upsertStaffPlan(ctxFor("tr"), "s1", { name: "Monisha", role: "owner", active: false }, { name: "Monisha", role: "owner", active: true, pinHash: HASH } as never);
    expect(p.ops[0]?.data).not.toHaveProperty("pinHash");
  });
});

describe("admin till sign-in", () => {
  const withPin: AdminPerson = { uid: "u1", name: "Ravi", active: true, pinHash: HASH };
  const noPin: AdminPerson = { uid: "u2", name: "Asha", active: true };

  it("assigning an admin with a PIN adds their staff entry; unassigning switches it off", () => {
    const add = assignAdminsPlan(ctxFor("tr"), "Tea Room", [], ["u1", "u2"], [withPin, noPin]);
    const staff = add.ops.filter((o) => o.path.includes("/staff/"));
    expect(staff).toHaveLength(1); // u2 has no PIN yet → nothing to sign in with
    expect(staff[0]).toMatchObject({ path: `clients/tr/staff/${adminStaffId("u1")}`, op: "merge", data: { name: "Ravi", role: "owner", adminUid: "u1", pinHash: HASH, active: true } });
    const remove = assignAdminsPlan(ctxFor("tr"), "Tea Room", ["u1"], [], [withPin]);
    expect(remove.ops.find((o) => o.path.includes("/staff/"))?.data.active).toBe(false);
    const same = assignAdminsPlan(ctxFor("tr"), "Tea Room", ["u1"], ["u1"], [withPin]);
    expect(same.ops.some((o) => o.path.includes("/staff/"))).toBe(false);
  });

  it("a new PIN lands on platformUsers and every assigned client, audited without the hash", () => {
    const p = adminTillPlan(2_000, withPin, [ctxFor("tr"), ctxFor("cafe")], "pin");
    expect(p.ops.find((o) => o.path === "platformUsers/u1")?.data).toEqual({ pinHash: HASH, updatedAtMs: 2_000 });
    expect(p.ops.filter((o) => o.path.endsWith(`/staff/${adminStaffId("u1")}`)).map((o) => o.path)).toEqual([`clients/tr/staff/adm_u1`, `clients/cafe/staff/adm_u1`]);
    const audits = p.ops.filter((o) => o.path.includes("/auditLog/"));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(HASH);
  });

  it("deactivating an admin switches their till entries off", () => {
    const p = adminTillPlan(2_000, { ...withPin, active: false }, [ctxFor("tr")], "status");
    expect(p.ops).toHaveLength(1);
    expect(p.ops[0]?.data.active).toBe(false);
  });
});

describe("kitchen switch", () => {
  it("defaults on for older clients", () => {
    expect(kitchenOn({})).toBe(true);
    expect(printsKots({})).toBe(true);
    expect(kitchenOn({ kitchen: { enabled: false, printKots: true } })).toBe(false);
    expect(printsKots({ kitchen: { enabled: false, printKots: true } })).toBe(false);
    expect(printsKots({ kitchen: { enabled: true, printKots: false } })).toBe(false);
  });

  it("with the kitchen off, KOTs are recorded already served", () => {
    const line: OrderLine = { lineId: "a", seq: 1, itemId: "tea", name: "Tea", categoryId: "c", station: "beverage", unitPricePaise: 2500, qty: 1, taxBps: 500, sentQty: 0, voidedQty: 0, addedBy: "s1", addedAtMs: 0 };
    const make = (kitchen?: boolean) =>
      kotPlan({ ...ctxFor("tr"), actorKind: "staff", terminalId: "t1", source: "app" }, {
        order: { create: { id: "o1", orderNo: "1-001", mode: "dineIn", businessDate: "2026-10-05", tableId: "t", tableLabel: "T1" } },
        lines: [line],
        alloc: { numbers: [1], terminalCode: "1" },
        tracked: new Set(),
        ...(kitchen === undefined ? {} : { kitchen }),
      }).ops.find((o) => o.path.includes("/kots/"))?.data;
    expect(make()?.status).toBe("new");
    expect(make(false)?.status).toBe("served");
    expect(make(false)?.statusAtMs).toEqual({ new: 1_000, served: 1_000 });
  });
});

describe("delete admin", () => {
  it("switches them off for good, unassigns every client and their till sign-in, one batch", () => {
    const a: AdminPerson = { uid: "u1", name: "Ravi", active: true, pinHash: HASH };
    const p = deleteAdminPlan(5_000, a, [
      { ctx: ctxFor("tr"), name: "Tea Room", adminUids: ["u1", "u9"] },
      { ctx: ctxFor("cafe"), name: "Cafe", adminUids: ["u1"] },
    ]);
    const user = p.ops.find((o) => o.path === "platformUsers/u1");
    expect(user?.op).toBe("update");
    expect(user?.data).toMatchObject({ active: false, deletedAtMs: 5_000, pinHash: { $delete: true } });
    expect(p.ops.find((o) => o.path === "clients/tr")?.data.adminUids).toEqual(["u9"]);
    expect(p.ops.find((o) => o.path === "clients/cafe")?.data.adminUids).toEqual([]);
    expect(p.ops.filter((o) => o.path.endsWith("/staff/adm_u1")).map((o) => o.data.active)).toEqual([false, false]);
    expect(p.ops.filter((o) => o.path.includes("/auditLog/"))).toHaveLength(2);
    expect(JSON.stringify(p.ops.filter((o) => o.path.includes("/auditLog/")))).not.toContain(HASH);
  });
  it("an admin without a PIN or clients is just switched off", () => {
    const p = deleteAdminPlan(5_000, { uid: "u2", name: "Asha", active: true }, []);
    expect(p.ops.map((o) => o.path)).toEqual(["platformUsers/u2"]);
  });
});
