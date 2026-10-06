import { describe, expect, it } from "vitest";
import { duplicateClientPlans, type ClientCopySource } from "../src/plans/admin";
import type { PlanCtx } from "../src/plans/types";
import type { Client } from "../src/types";

const m = { schemaVersion: 1 as const, createdAtMs: 1, createdAt: { seconds: 1 }, updatedAtMs: 2, source: "admin" as const };
const src: ClientCopySource = {
  client: {
    ...m,
    id: "tea-room-kodambakkam-gkkk",
    name: "Tea Room, Kodambakkam",
    legalName: "Tea Room",
    address: "1/3/1 United India Colony Main Road",
    city: "Chennai",
    stateName: "Tamil Nadu",
    stateCode: "33",
    phone: "9840000000",
    gstin: "33AAAAA0000A1Z5",
    fssai: "12345678901234",
    upi: { vpa: "tearoom@okicici", payee: "Tea Room" },
    adminUids: ["admin1"],
    status: "active",
    lastZNo: 7,
    taxMode: "regular",
    defaultTaxBps: 500,
    receipt: { header: [], footer: ["Thank you!"], showSac: true, logo: { w: 8, h: 1, data: "/w==" } },
    priceMode: "exclusive",
  } as unknown as Client,
  categories: [{ ...m, id: "c1", name: "Hot Drinks", sort: 1, station: "beverage", active: true }],
  items: [{ ...m, id: "i1", name: "Tea", categoryId: "c1", pricePaise: 2500, taxBps: 500 } as never],
  photos: [
    { ...m, id: "i1", itemId: "i1", mime: "image/jpeg", w: 400, h: 400, bytes: 30, data: "a".repeat(3_000_000), active: true } as never,
    { ...m, id: "i2", itemId: "i2", mime: "image/jpeg", w: 400, h: 400, bytes: 30, data: "b".repeat(3_000_000), active: true } as never,
    { ...m, id: "i3", itemId: "i3", mime: "image/jpeg", w: 400, h: 400, bytes: 30, data: "c", active: false } as never,
  ],
  floors: [{ ...m, id: "f1", name: "Main", sort: 1, active: true }],
  tables: [{ ...m, id: "t1", floorId: "f1", label: "T1", seats: 4, sort: 1, active: true } as never],
};
const ctx: PlanCtx = { cid: "post-office-cafe-test-ab12", nowMs: 99, actorId: "boss", actorKind: "platform", source: "admin", newId: () => "a1" };

describe("duplicate client", () => {
  const plans = duplicateClientPlans(ctx, src, "Post Office Cafe Test");

  it("copies settings and the logo, never the outlet's identity, admins or history", () => {
    const c = plans[0]!.ops[0]!.data as Record<string, unknown>;
    expect(plans[0]!.ops[0]!.path).toBe("clients/post-office-cafe-test-ab12");
    expect(c).toMatchObject({ name: "Post Office Cafe Test", legalName: "Post Office Cafe Test", city: "Chennai", stateCode: "33", taxMode: "regular", fssai: "", adminUids: [], status: "active", lastZNo: 0, createdAtMs: 99 });
    expect((c.receipt as Client["receipt"]).logo).toEqual({ w: 8, h: 1, data: "/w==" });
    for (const k of ["gstin", "phone", "upi", "id", "priceMode"]) expect(c).not.toHaveProperty(k);
    expect(plans[0]!.ops[1]!.data).toMatchObject({ action: "client.duplicate", after: { from: "Tea Room, Kodambakkam", items: 1, photos: 2 } });
  });

  it("keeps doc ids so items still find their categories and photos their items", () => {
    const menu = plans[1]!.ops;
    expect(menu.map((o) => o.path)).toEqual([
      "clients/post-office-cafe-test-ab12/categories/c1",
      "clients/post-office-cafe-test-ab12/items/i1",
      "clients/post-office-cafe-test-ab12/floors/f1",
      "clients/post-office-cafe-test-ab12/tables/t1",
    ]);
    expect(menu[1]!.data).toMatchObject({ categoryId: "c1", pricePaise: 2500, createdAtMs: 99 });
    expect(menu[1]!.data).not.toHaveProperty("id");
  });

  it("splits big photos across batches and skips removed ones", () => {
    const photoPlans = plans.slice(2);
    expect(photoPlans).toHaveLength(2);
    expect(photoPlans.flatMap((p) => p.ops.map((o) => o.path))).toEqual(["clients/post-office-cafe-test-ab12/itemPhotos/i1", "clients/post-office-cafe-test-ab12/itemPhotos/i2"]);
    expect(photoPlans[0]!.ops[0]!.data).toMatchObject({ itemId: "i1", active: true });
  });
});
