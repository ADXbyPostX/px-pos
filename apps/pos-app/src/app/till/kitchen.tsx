import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Redirect } from "expo-router";
import { kitchenOn, kotStatusPlan, minutesSince, STATION_LABEL, type Kot, type KotStatus, type Station } from "@px-pos/core";
import { planCtx } from "@/actions/context";
import { Text } from "@/components/ui/text";
import { applyPlan } from "@/firebase/apply-plan";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useNow, type WithId } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";

const NEXT: Record<KotStatus, KotStatus | null> = { new: "preparing", preparing: "ready", ready: "served", served: null };
const LABEL: Record<KotStatus, string> = { new: "New", preparing: "Preparing", ready: "Ready", served: "Served" };

/** Kitchen display, only while the admin has the kitchen on (the client doc is live). */
export default function KitchenScreen() {
  const { client } = usePaired();
  if (!kitchenOn(client)) return <Redirect href="/till" />;
  return <Kitchen />;
}

/** Today's KOTs oldest first; tap a ticket to move it along. */
function Kitchen() {
  const session = usePaired();
  const { client } = session;
  const { kots } = useData();
  const { operator } = useOperator();
  const { width, size } = useBreakpoint();
  const now = useNow(15_000);
  const [station, setStation] = useState<Station | "all">("all");
  const [showServed, setShowServed] = useState(false);
  const stations = useMemo(() => [...new Set(kots.map((k) => k.station))], [kots]);
  const list = useMemo(
    () => kots.filter((k) => (station === "all" || k.station === station) && (showServed ? k.status === "served" : k.status !== "served")).sort((a, b) => (showServed ? b.createdAtMs - a.createdAtMs : a.createdAtMs - b.createdAtMs)),
    [kots, station, showServed],
  );
  const cols = size === "phone" ? 1 : Math.max(2, Math.floor((width - 80) / 300));

  function bump(k: WithId<Kot>, to: KotStatus | null) {
    if (!to) return;
    void applyPlan(kotStatusPlan(planCtx(session, operator), k.id, to)).catch(() => {});
  }

  return (
    <View className="flex-1">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0 border-b border-border" contentContainerClassName="gap-2 px-4 py-2">
        {(["all", ...stations] as (Station | "all")[]).map((s) => (
          <Pressable key={s} onPress={() => setStation(s)} accessibilityRole="tab" accessibilityState={{ selected: station === s }} className={cn("min-h-11 justify-center rounded-full border px-4", station === s ? "border-primary bg-primary/15" : "border-border")}>
            <Text className={station === s ? "font-semibold" : ""}>{s === "all" ? "All stations" : STATION_LABEL[s]}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setShowServed((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: showServed }} className={cn("min-h-11 justify-center rounded-full border px-4", showServed ? "border-primary bg-primary/15" : "border-border")}>
          <Text className={showServed ? "font-semibold" : ""}>Served (recall)</Text>
        </Pressable>
      </ScrollView>
      {list.length === 0 ? (
        <Text className="p-8 text-center text-muted-foreground">{showServed ? "Nothing served yet today" : "No tickets in the kitchen"}</Text>
      ) : (
        <ScrollView contentContainerClassName="flex-row flex-wrap p-1.5">
          {list.map((k) => {
            const age = minutesSince(k.createdAtMs, now);
            const tone = k.status === "ready" ? "success" : age >= client.kds.lateMin ? "primary" : age >= client.kds.warnMin ? "warning" : "border";
            const next = showServed ? "ready" : NEXT[k.status];
            return (
              <View key={k.id} style={{ width: `${100 / cols}%` }} className="p-1.5">
                <View className={cn("overflow-hidden rounded-2xl border-2 bg-card", tone === "success" ? "border-success" : tone === "primary" ? "border-primary" : tone === "warning" ? "border-warning" : "border-border")}>
                  <Pressable onPress={() => bump(k, next)} accessibilityRole="button" accessibilityLabel={`KOT ${k.kotNo}, ${LABEL[k.status]}. ${next ? `Tap to mark ${LABEL[next]}` : ""}`} className="flex-row items-center justify-between gap-2 border-b border-border px-4 py-3 active:bg-accent">
                    <View>
                      <Text className="text-3xl font-bold">{k.kotNo}</Text>
                      <Text className="text-base text-muted-foreground">{k.where}</Text>
                    </View>
                    <View className="items-end">
                      <Text className={cn("text-xl font-bold tabular-nums", tone === "primary" ? "text-primary" : tone === "warning" ? "text-warning" : "")}>{age} min</Text>
                      <Text className={cn("text-sm font-semibold", k.status === "ready" ? "text-success" : k.status === "preparing" ? "text-qc" : "")}>{LABEL[k.status]}</Text>
                      {next ? <Text className="text-xs text-muted-foreground" numberOfLines={1}>{`Tap → ${LABEL[next]}`}</Text> : null}
                    </View>
                  </Pressable>
                  {k.kind !== "new" ? <Text className={cn("px-4 pt-2 text-sm font-bold", k.kind === "cancel" ? "text-primary" : "text-warning")}>{k.kind === "cancel" ? "CANCELLED" : "ADD-ON"}</Text> : null}
                  <View className="gap-1 px-4 py-3">
                    {k.items.map((it) => (
                      <View key={it.lineId}>
                        <Text className={cn("text-xl font-semibold", k.kind === "cancel" && "line-through")}>
                          {it.qty} × {it.name}
                          {it.variantName ? ` (${it.variantName})` : ""}
                        </Text>
                        {it.note ? <Text className="text-base text-warning">{it.note}</Text> : null}
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
