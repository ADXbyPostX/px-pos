import { describe, expect, it } from "vitest";
import { base64Bytes, matchPhotoFiles, photoKey, photoUri, validateItemPhoto } from "../src/menu-photos";
import { combinePlans, itemPhotoPlan, upsertCategoryPlan } from "../src/plans/admin";
import type { PlanCtx } from "../src/plans/types";

let n = 0;
const ctx: PlanCtx = { cid: "c1", nowMs: 1_760_000_000_000, actorId: "super", actorKind: "platform", source: "admin", newId: () => `id${++n}` };

const ITEMS = [
  { id: "tea", name: "Tea" },
  { id: "glt", name: "Ginger Lemon Tea" },
  { id: "bbj", name: "Bun Butter Jam" },
  { id: "maggi", name: "Classic Maggi", shortName: "Maggi" },
  { id: "fc", name: "Filter Coffee", code: "FC" },
  { id: "mo", name: "Maggi & Oats Combo" },
];

// 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("photoKey", () => {
  it("ignores case, spacing, punctuation and the extension", () => {
    expect(photoKey("Ginger-Lemon_Tea.JPG")).toBe("gingerlemontea");
    expect(photoKey("ginger lemon tea")).toBe("gingerlemontea");
    expect(photoKey("Maggi & Oats Combo.webp")).toBe("maggiandoatscombo");
  });
});

describe("matchPhotoFiles", () => {
  it("matches by name, short name and code, and drops copy markers", () => {
    const m = matchPhotoFiles(["tea.jpg", "GINGER_LEMON_TEA (1).jpeg", "bun-butter-jam copy.png", "Maggi.jpg", "fc.jpg", "maggi and oats combo.jpg"], ITEMS);
    expect(m.map((x) => (x.status === "matched" ? x.itemId : x.status))).toEqual(["tea", "glt", "bbj", "maggi", "fc", "mo"]);
  });

  it("flags files that match nothing, and a second photo for the same item", () => {
    const m = matchPhotoFiles(["Tea.jpg", "tea-2.jpg", "samosa.jpg"], ITEMS);
    expect(m).toEqual([
      { file: "Tea.jpg", status: "matched", itemId: "tea" },
      { file: "tea-2.jpg", status: "duplicate", itemId: "tea" },
      { file: "samosa.jpg", status: "none" },
    ]);
  });

  it("refuses to guess when two items share a name", () => {
    const m = matchPhotoFiles(["Tea.jpg"], [...ITEMS, { id: "tea2", name: "TEA" }]);
    expect(m[0]).toEqual({ file: "Tea.jpg", status: "ambiguous", itemIds: ["tea", "tea2"] });
  });

  it("keeps a name that really ends in digits", () => {
    const m = matchPhotoFiles(["Pepsi 500.jpg"], [{ id: "p", name: "Pepsi 500" }]);
    expect(m[0]).toEqual({ file: "Pepsi 500.jpg", status: "matched", itemId: "p" });
  });
});

describe("validateItemPhoto", () => {
  it("accepts a small JPEG/PNG and computes its size", () => {
    expect(base64Bytes(PNG)).toBe(68);
    expect(validateItemPhoto({ mime: "image/png", w: 400, h: 400, bytes: 68, data: PNG })).toBeNull();
  });

  it("rejects bad types, damaged data, huge photos and odd sizes", () => {
    expect(validateItemPhoto({ mime: "image/gif" as never, w: 400, h: 400, data: PNG })).toMatch(/JPEG/);
    expect(validateItemPhoto({ mime: "image/png", w: 400, h: 400, data: "data:image/png;base64," + PNG })).toMatch(/damaged/);
    expect(validateItemPhoto({ mime: "image/jpeg", w: 400, h: 400, data: "A".repeat(300_000) })).toMatch(/too large/);
    expect(validateItemPhoto({ mime: "image/png", w: 10, h: 400, data: PNG })).toMatch(/size/);
  });

  it("builds a data URI only for an active photo", () => {
    expect(photoUri({ mime: "image/png", data: PNG, active: true })).toBe(`data:image/png;base64,${PNG}`);
    expect(photoUri({ mime: "image/png", data: "", active: false })).toBeNull();
    expect(photoUri(null)).toBeNull();
  });
});

describe("itemPhotoPlan", () => {
  it("writes the photo doc and an audit entry without the image data", () => {
    const plan = itemPhotoPlan(ctx, { itemId: "tea", itemName: "Tea", photo: { mime: "image/png", w: 400, h: 400, bytes: 68, data: PNG }, hadPhoto: false });
    expect(plan.primaryPath).toBe("clients/c1/itemPhotos/tea");
    expect(plan.ops[0]).toMatchObject({ path: "clients/c1/itemPhotos/tea", op: "set", data: { itemId: "tea", active: true, data: PNG, bytes: 68 } });
    expect(plan.ops[1]!.data).toMatchObject({ action: "item.photo", after: { photo: "added", bytes: 68 } });
    expect(JSON.stringify(plan.ops[1])).not.toContain(PNG);
  });

  it("removes a photo by clearing it, never by deleting the doc", () => {
    const plan = itemPhotoPlan(ctx, { itemId: "tea", itemName: "Tea", photo: null, hadPhoto: true });
    expect(plan.ops[0]).toMatchObject({ op: "set", data: { active: false, data: "", bytes: 0 } });
    expect(plan.ops[1]!.data).toMatchObject({ after: { photo: "removed" } });
  });

  it("combines with another plan into one batch", () => {
    const photo = itemPhotoPlan(ctx, { itemId: "tea", itemName: "Tea", photo: null, hadPhoto: true });
    const cat = upsertCategoryPlan(ctx, "hot", { name: "Hot", sort: 1, station: "beverage", active: true }, true);
    const both = combinePlans("Save Tea", [cat, photo]);
    expect(both.ops).toHaveLength(3);
    expect(both.primaryPath).toBe(cat.primaryPath);
    expect(both.postingKey).toBeUndefined();
  });
});
