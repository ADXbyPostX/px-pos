"use client";

import { createContext, use } from "react";
import type { BizDate, Material, PricePoint } from "@px-pos/core";
import type { useInventory, useStockDays } from "@/hooks/use-inventory";
import type { useItems, useStock } from "@/hooks/use-menu";
import type { useMaterials } from "@/hooks/use-vendors";
import type { WithId } from "@/lib/firebase/hooks";

export type MoveKind = "in" | "waste" | "adjust";
export type ItemMoveKind = "in" | "waste" | "count";

/** One place a material is used: an item (and size) and how much per one sold. */
export interface UsedIn {
  itemId: string;
  itemName: string;
  size?: string;
  qtyMicro: number;
}

export interface InventoryActions {
  today: BizDate;
  materials: ReturnType<typeof useMaterials>;
  inventory: ReturnType<typeof useInventory>;
  items: ReturnType<typeof useItems>;
  stock: ReturnType<typeof useStock>;
  /** Last 14 days of stats (per-material movements, items sold). */
  days: ReturnType<typeof useStockDays>;
  rates: Map<string, PricePoint>;
  usedIn: Map<string, UsedIn[]>;
  terminalName: (id: string) => string;
  sheet: string | null;
  openMaterial: (id: string) => void;
  closeSheet: () => void;
  move: (kind: MoveKind, materialId?: string) => void;
  count: (materialIds?: string[]) => void;
  itemMove: (kind: ItemMoveKind, itemId: string) => void;
  addMaterial: () => void;
  editMaterial: (m: WithId<Material>) => void;
}

export const InventoryCtx = createContext<InventoryActions | null>(null);

export function useInventoryActions(): InventoryActions {
  const v = use(InventoryCtx);
  if (!v) throw new Error("useInventoryActions must be used inside <InventoryProvider>");
  return v;
}
