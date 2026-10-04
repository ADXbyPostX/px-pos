import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { deliveryStagePlan, formatINR, MODE_LABEL, minutesSince, orderWhere, type DeliveryStage, type Order, type OrderMode } from "@px-pos/core";
import { billFor } from "@/actions/orders";
import { planCtx } from "@/actions/context";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { applyPlan } from "@/firebase/apply-plan";
import { useNow, type WithId } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";

const NEXT_STAGE: Partial<Record<DeliveryStage, DeliveryStage>> = { placed: "preparing", accepted: "preparing", preparing: "ready", ready: "out", out: "delivered" };
const STAGE_LABEL: Record<DeliveryStage, string> = { placed: "Placed", accepted: "Accepted", preparing: "Preparing", ready: "Ready", out: "Out", delivered: "Delivered" };

type Filter = "all" | OrderMode;

/** Running orders on this outlet (every terminal): open tables, quick tokens, deliveries. */
export default function Orders() {
  const session = usePaired();
  const { client } = session;
  const { openOrders } = useData();
  const { operator } = useOperator();
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>("all");
  const modes = (["dineIn", "quick", "delivery"] as const).filter((m) => client.orderModes[m] || openOrders.some((o) => o.mode === m));
  const list = useMemo(() => openOrders.filter((o) => filter === "all" || o.mode === filter).sort((a, b) => a.createdAtMs - b.createdAtMs), [openOrders, filter]);

  function advance(o: WithId<Order>) {
    const next = o.delivery ? NEXT_STAGE[o.delivery.stage] : undefined;
    if (!next) return;
    // Stage changes carry no money: a plain queued batch (the native SDK persists it offline).
    void applyPlan(deliveryStagePlan(planCtx(session, operator), o, next)).catch(() => {});
  }

  return (
    <View className="flex-1">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0 border-b border-border" contentContainerClassName="gap-2 px-4 py-2">
        {(["all", ...modes] as Filter[]).map((f) => {
          const n = f === "all" ? openOrders.length : openOrders.filter((o) => o.mode === f).length;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: filter === f }} className={cn("min-h-11 flex-row items-center gap-2 rounded-full border px-4", filter === f ? "border-primary bg-primary/15" : "border-border")}>
              <Text className={filter === f ? "font-semibold" : ""}>{f === "all" ? "All" : MODE_LABEL[f]}</Text>
              <Text className="text-sm text-muted-foreground tabular-nums">{n}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {list.length === 0 ? (
        <Text className="p-8 text-center text-muted-foreground">No running orders</Text>
      ) : (
        <ScrollView contentContainerClassName="gap-2 p-3">
          {list.map((o) => {
            const total = o.bill?.grandTotalPaise ?? billFor(client, o.mode, Object.values(o.lines)).grandTotalPaise;
            const next = o.delivery ? NEXT_STAGE[o.delivery.stage] : undefined;
            const mine = o.terminalId === session.tid;
            return (
              <Pressable key={o.id} onPress={() => router.push(`/till/order?id=${o.id}`)} accessibilityRole="button" className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-accent">
                <View className="flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-lg font-bold" numberOfLines={1}>
                      {orderWhere(o.mode, { tableLabel: o.tableLabel, token: o.token, customer: o.customer, orderNo: o.orderNo })}
                    </Text>
                    <View className={cn("rounded-full px-2 py-0.5", o.status === "billed" ? "bg-warning/20" : "bg-primary/15")}>
                      <Text className={cn("text-xs font-semibold", o.status === "billed" ? "text-warning" : "text-primary")}>{o.status === "billed" ? "Billed" : "Running"}</Text>
                    </View>
                    {o.flags?.conflict ? <Text className="text-xs font-semibold text-warning">Merge required</Text> : null}
                  </View>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {MODE_LABEL[o.mode]} · {o.orderNo} · {minutesSince(o.createdAtMs, now)} min{mine ? "" : " · other terminal"}
                    {o.delivery ? ` · ${o.delivery.pay === "cod" ? "COD" : "Prepaid"}` : ""}
                  </Text>
                </View>
                <Text className="text-lg font-semibold tabular-nums">{formatINR(total, { decimals: "auto" })}</Text>
                {o.delivery ? (
                  <Button size="sm" variant={next ? "secondary" : "ghost"} disabled={!next} onPress={() => advance(o)} accessibilityLabel={next ? `Mark ${STAGE_LABEL[next]}` : STAGE_LABEL[o.delivery.stage]}>
                    <Text>{next ? `→ ${STAGE_LABEL[next]}` : STAGE_LABEL[o.delivery.stage]}</Text>
                  </Button>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
