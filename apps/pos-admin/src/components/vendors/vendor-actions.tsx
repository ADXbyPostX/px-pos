"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { collection, query } from "firebase/firestore";
import { addDays, lastRates, paths, vendorBalance, type Material, type Purchase, type Terminal, type Vendor, type VendorPayment } from "@px-pos/core";
import { todayBiz } from "@/components/shared/range-picker";
import { useClient } from "@/components/providers/client-provider";
import { useInventory } from "@/hooks/use-inventory";
import { useStaff } from "@/hooks/use-menu";
import { useMaterials, useRecentPurchases, useVendors } from "@/hooks/use-vendors";
import { useCollection, useNow, type WithId } from "@/lib/firebase/hooks";
import { VendorActionsCtx, type SheetTarget, type VendorActions } from "./context";
import { EditBillDialog, MaterialDialog } from "./edit-dialogs";
import { PaymentDialog } from "./payment-dialog";
import { PurchaseDialog } from "./purchase-dialog";
import { VendorSheetHost } from "./sheets";
import { VendorDialog } from "./vendor-dialog";
import { VoidDialog, type VoidTarget } from "./void-dialog";

/** How far back the shared bill listener reaches (dues are always the newest bills). */
const RECENT_DAYS = 120;

/**
 * Everything the three Vendors pages share: the live vendor, material and recent-bill listeners,
 * the record sheets (stacked) and every dialog. Mounted once by the vendors layout.
 */
export function VendorActionsProvider({ children }: { children: ReactNode }) {
  const { cid, client } = useClient();
  const now = useNow(60_000);
  const today = todayBiz(client.day.cutoffMin, now);
  const vendors = useVendors(cid);
  const materials = useMaterials(cid);
  const recent = useRecentPurchases(cid, addDays(today, -RECENT_DAYS));
  const rates = useMemo(() => lastRates(recent.data), [recent.data]);
  const staff = useStaff(cid);
  const inventory = useInventory(cid);
  const terminals = useCollection<Terminal>(`terminals:${cid}`, (db) => query(collection(db, paths.col(cid, "terminals"))));

  const terminalName = useMemo(() => {
    const m = new Map(terminals.data.map((t) => [t.id, t.name]));
    return (id: string) => m.get(id) ?? "a till";
  }, [terminals.data]);
  const who = useMemo(() => {
    const m = new Map(staff.data.map((s) => [s.id, s.name]));
    return (actorId: string | undefined, terminalId?: string) => {
      const name = actorId ? m.get(actorId) : undefined;
      if (name) return terminalId ? `${name} · ${terminalName(terminalId)}` : name;
      return terminalId ? terminalName(terminalId) : "Admin panel";
    };
  }, [staff.data, terminalName]);

  const [stack, setStack] = useState<SheetTarget[]>([]);
  const [vendorDialog, setVendorDialog] = useState<{ open: boolean; vendor: WithId<Vendor> | null }>({ open: false, vendor: null });
  const [purchaseFor, setPurchaseFor] = useState<{ open: boolean; vendorId: string | null }>({ open: false, vendorId: null });
  const [payFor, setPayFor] = useState<{ open: boolean; vendorId: string | null }>({ open: false, vendorId: null });
  const [voiding, setVoiding] = useState<VoidTarget | null>(null);
  const [editingBill, setEditingBill] = useState<WithId<Purchase> | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<WithId<Material> | null>(null);

  const open = useCallback((t: SheetTarget) => setStack([t]), []);
  const push = useCallback((t: SheetTarget) => setStack((s) => (s.at(-1)?.kind === t.kind && s.at(-1)?.id === t.id ? s : [...s, t])), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeSheets = useCallback(() => setStack([]), []);

  const value = useMemo<VendorActions>(
    () => ({
      today,
      vendors,
      materials,
      recent,
      rates,
      terminalName,
      who,
      stack,
      open,
      push,
      back,
      closeSheets,
      addVendor: () => setVendorDialog({ open: true, vendor: null }),
      editVendor: (v) => setVendorDialog({ open: true, vendor: v }),
      recordPurchase: (vendorId) => setPurchaseFor({ open: true, vendorId: vendorId ?? null }),
      pay: (vendorId) => setPayFor({ open: true, vendorId: vendorId ?? null }),
      voidPurchase: (p: WithId<Purchase>) => setVoiding({ kind: "purchase", purchase: p }),
      voidPayment: (p: WithId<VendorPayment>) => setVoiding({ kind: "payment", payment: p }),
      editBill: setEditingBill,
      editMaterial: setEditingMaterial,
    }),
    [today, vendors, materials, recent, rates, terminalName, who, stack, open, push, back, closeSheets],
  );

  const voidVendorId = voiding ? (voiding.kind === "purchase" ? voiding.purchase.vendorId : voiding.payment.vendorId) : null;

  return (
    <VendorActionsCtx value={value}>
      {children}
      <VendorSheetHost />
      <VendorDialog open={vendorDialog.open} onOpenChange={(o) => setVendorDialog((d) => ({ ...d, open: o }))} vendor={vendorDialog.vendor} materials={materials.data} today={today} />
      <PurchaseDialog
        open={purchaseFor.open}
        onOpenChange={(o) => setPurchaseFor((d) => ({ ...d, open: o }))}
        vendorId={purchaseFor.vendorId}
        vendors={vendors.data}
        materials={materials.data}
        recent={recent.data}
        rates={rates}
        today={today}
      />
      <PaymentDialog open={payFor.open} onOpenChange={(o) => setPayFor((d) => ({ ...d, open: o }))} vendorId={payFor.vendorId} vendors={vendors.data} today={today} />
      <VoidDialog target={voiding} onOpenChange={(o) => !o && setVoiding(null)} balancePaise={vendorBalance(voidVendorId ? vendors.byId.get(voidVendorId) : null)} terminalName={terminalName} />
      <EditBillDialog bill={editingBill} onOpenChange={(o) => !o && setEditingBill(null)} />
      <MaterialDialog material={editingMaterial} onOpenChange={(o) => !o && setEditingMaterial(null)} onHand={editingMaterial ? (inventory.onHand[editingMaterial.id] ?? 0) : 0} />
    </VendorActionsCtx>
  );
}
