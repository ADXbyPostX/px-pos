import type { ComponentType } from "react";
import { useGlobalSearchParams, usePathname, type Href } from "expo-router";
import { Armchair, Bike, CalendarCheck, ChefHat, ReceiptText, Zap } from "lucide-react-native";
import type { OrderMode } from "@px-pos/core";
import { useHeld } from "@/local/held";
import { useData } from "@/state/data";
import { usePaired } from "@/state/session";

export interface TillNavEntry {
  href: Href;
  label: string;
  Icon: ComponentType<{ color?: string; size?: number }>;
  active: boolean;
  badge?: number;
}

/**
 * Till destinations (rail on tablets, tabs on phones): only the order modes the admin enabled.
 * The register (/till/order) belongs to whichever mode its order is in.
 */
export function useTillNav(): TillNavEntry[] {
  const { cid, client } = usePaired();
  const { openOrders } = useData();
  const held = useHeld(cid);
  const path = usePathname();
  const params = useGlobalSearchParams<{ mode?: string; id?: string }>();
  const onRegister = path.startsWith("/till/order");
  const registerMode: OrderMode | undefined = onRegister ? ((params.mode as OrderMode | undefined) ?? openOrders.find((o) => o.id === params.id)?.mode) : undefined;
  const at = (prefix: string) => path.startsWith(prefix);
  return [
    ...(client.orderModes.dineIn ? [{ href: "/till/tables" as Href, label: "Tables", Icon: Armchair, active: at("/till/tables") || registerMode === "dineIn" }] : []),
    // Badge: customers parked on hold, waiting to finish their order.
    ...(client.orderModes.quick ? [{ href: "/till/order?mode=quick" as Href, label: "Quick", Icon: Zap, active: registerMode === "quick", badge: held.length }] : []),
    ...(client.orderModes.delivery ? [{ href: "/till/delivery" as Href, label: "Delivery", Icon: Bike, active: at("/till/delivery") || registerMode === "delivery" }] : []),
    { href: "/till/orders", label: "Orders", Icon: ReceiptText, active: at("/till/orders"), badge: openOrders.length },
    { href: "/till/kitchen", label: "Kitchen", Icon: ChefHat, active: at("/till/kitchen") },
    { href: "/till/day", label: "Day", Icon: CalendarCheck, active: at("/till/day") },
  ];
}
