import { InventoryProvider } from "@/components/inventory/inventory-provider";

/** Stock, Usage and Ledger share their listeners, the material sheet and the dialogs. */
export default function StockLayout({ children }: LayoutProps<"/c/[cid]/stock">) {
  return <InventoryProvider>{children}</InventoryProvider>;
}
