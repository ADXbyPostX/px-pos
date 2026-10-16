"use client";

import { createContext, use } from "react";
import type { BizDate, Material, PricePoint, Purchase, Vendor, VendorPayment } from "@px-pos/core";
import type { useMaterials, useRecentPurchases, useVendors } from "@/hooks/use-vendors";
import type { WithId } from "@/lib/firebase/hooks";

/** What a detail sheet shows. Sheets stack: a bill opened from a vendor has a Back button. */
export type SheetTarget = { kind: "vendor" | "purchase" | "payment" | "material"; id: string };

export interface VendorActions {
  /** Today's business date. */
  today: BizDate;
  vendors: ReturnType<typeof useVendors>;
  materials: ReturnType<typeof useMaterials>;
  /** Bills dated in the last 120 days (statuses, last rates, "same as last bill"). */
  recent: ReturnType<typeof useRecentPurchases>;
  /** Latest rate paid per material. */
  rates: Map<string, PricePoint>;
  terminalName: (id: string) => string;
  /** Who entered or paid: a staff member, a till, or the admin panel. */
  who: (actorId: string | undefined, terminalId?: string) => string;
  stack: SheetTarget[];
  /** Open a sheet on its own (from a page). */
  open: (t: SheetTarget) => void;
  /** Open a sheet on top of the current one (from inside a sheet). */
  push: (t: SheetTarget) => void;
  back: () => void;
  closeSheets: () => void;
  addVendor: () => void;
  editVendor: (v: WithId<Vendor>) => void;
  recordPurchase: (vendorId?: string | null) => void;
  pay: (vendorId?: string | null) => void;
  voidPurchase: (p: WithId<Purchase>) => void;
  voidPayment: (p: WithId<VendorPayment>) => void;
  editBill: (p: WithId<Purchase>) => void;
  editMaterial: (m: WithId<Material>) => void;
}

export const VendorActionsCtx = createContext<VendorActions | null>(null);

export function useVendorActions(): VendorActions {
  const v = use(VendorActionsCtx);
  if (!v) throw new Error("useVendorActions must be used inside <VendorActionsProvider>");
  return v;
}
