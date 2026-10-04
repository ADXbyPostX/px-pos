import type { ReactNode } from "react";
import { Redirect } from "expo-router";
import type { OrderMode } from "@px-pos/core";
import { usePaired } from "@/state/session";

/**
 * A screen for one order mode exists only while the admin has that mode switched on
 * (pos-admin → Order modes). The client doc is live, so switching it off moves the till away.
 */
export function ModeGate({ mode, children }: { mode: OrderMode; children: ReactNode }) {
  const { client } = usePaired();
  if (!client.orderModes[mode]) return <Redirect href="/till" />;
  return children;
}
