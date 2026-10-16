"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { collection, query } from "firebase/firestore";
import { addDays, lastRates, paths, RECIPE_BASE, type Material, type Terminal } from "@px-pos/core";
import { todayBiz } from "@/components/shared/range-picker";
import { useClient } from "@/components/providers/client-provider";
import { MaterialDialog } from "@/components/vendors/edit-dialogs";
import { useInventory, useStockDays } from "@/hooks/use-inventory";
import { useItems, useStock } from "@/hooks/use-menu";
import { useMaterials, useRecentPurchases } from "@/hooks/use-vendors";
import { useCollection, useNow, type WithId } from "@/lib/firebase/hooks";
import { InventoryCtx, type InventoryActions, type ItemMoveKind, type MoveKind, type UsedIn } from "./context";
import { CountDialog, ItemStockDialog, MoveDialog } from "./dialogs";
import { MaterialSheet } from "./material-sheet";

/** The Stock, Usage and Ledger pages share these listeners, the material sheet and every dialog. */
export function InventoryProvider({ children }: { children: ReactNode }) {
  const { cid, client } = useClient();
  const now = useNow(60_000);
  const today = todayBiz(client.day.cutoffMin, now);
  const materials = useMaterials(cid);
  const inventory = useInventory(cid);
  const items = useItems(cid);
  const stock = useStock(cid);
  const days = useStockDays(cid, addDays(today, -13));
  const recent = useRecentPurchases(cid, addDays(today, -120));
  const rates = useMemo(() => lastRates(recent.data), [recent.data]);
  const terminals = useCollection<Terminal>(`terminals:${cid}`, (db) => query(collection(db, paths.col(cid, "terminals"))));
  const terminalName = useMemo(() => {
    const m = new Map(terminals.data.map((t) => [t.id, t.name]));
    return (id: string) => m.get(id) ?? "a till";
  }, [terminals.data]);

  // Which items use each material, and how much per one sold (per size).
  const usedIn = useMemo(() => {
    const out = new Map<string, UsedIn[]>();
    for (const it of items.data) {
      if (!it.recipe) continue;
      for (const [key, lines] of Object.entries(it.recipe)) {
        const size = key === RECIPE_BASE ? undefined : it.variants.find((v) => v.id === key)?.name;
        for (const l of lines) out.set(l.materialId, [...(out.get(l.materialId) ?? []), { itemId: it.id, itemName: it.name, ...(size ? { size } : {}), qtyMicro: l.qtyMicro }]);
      }
    }
    return out;
  }, [items.data]);

  const [sheet, setSheet] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<{ open: boolean; kind: MoveKind; materialId: string | null }>({ open: false, kind: "in", materialId: null });
  const [countFor, setCountFor] = useState<{ open: boolean; only: string[] | null }>({ open: false, only: null });
  const [itemFor, setItemFor] = useState<{ open: boolean; kind: ItemMoveKind; itemId: string | null }>({ open: false, kind: "in", itemId: null });
  const [materialFor, setMaterialFor] = useState<{ open: boolean; material: WithId<Material> | null }>({ open: false, material: null });

  const openMaterial = useCallback((id: string) => setSheet(id), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const value = useMemo<InventoryActions>(
    () => ({
      today,
      materials,
      inventory,
      items,
      stock,
      days,
      rates,
      usedIn,
      terminalName,
      sheet,
      openMaterial,
      closeSheet,
      move: (kind, materialId) => setMoveFor({ open: true, kind, materialId: materialId ?? null }),
      count: (only) => setCountFor({ open: true, only: only ?? null }),
      itemMove: (kind, itemId) => setItemFor({ open: true, kind, itemId }),
      addMaterial: () => setMaterialFor({ open: true, material: null }),
      editMaterial: (m) => setMaterialFor({ open: true, material: m }),
    }),
    [today, materials, inventory, items, stock, days, rates, usedIn, terminalName, sheet, openMaterial, closeSheet],
  );

  const item = itemFor.itemId ? (items.data.find((i) => i.id === itemFor.itemId) ?? null) : null;
  return (
    <InventoryCtx value={value}>
      {children}
      <MaterialSheet />
      <MoveDialog kind={moveFor.kind} materialId={moveFor.materialId} open={moveFor.open} onOpenChange={(o) => setMoveFor((s) => ({ ...s, open: o }))} materials={materials.data} onHand={inventory.onHand} today={today} />
      <CountDialog open={countFor.open} onOpenChange={(o) => setCountFor((s) => ({ ...s, open: o }))} materials={materials.data} only={countFor.only} onHand={inventory.onHand} today={today} />
      <ItemStockDialog kind={itemFor.kind} item={item} open={itemFor.open} onOpenChange={(o) => setItemFor((s) => ({ ...s, open: o }))} onHand={item ? (stock.map.get(item.id) ?? 0) : 0} today={today} />
      <MaterialDialog
        open={materialFor.open}
        material={materialFor.material}
        onOpenChange={(o) => setMaterialFor((s) => ({ ...s, open: o }))}
        onHand={materialFor.material ? (inventory.onHand[materialFor.material.id] ?? 0) : 0}
      />
    </InventoryCtx>
  );
}
