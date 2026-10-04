import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { formatINR, minutesSince, type Order, type Table } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { ModeGate } from "@/components/pos/mode-gate";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useNow, type WithId } from "@/hooks/use-live";
import { billFor } from "@/actions/orders";
import { cn } from "@/lib/utils";
import { useData } from "@/state/data";
import { usePaired } from "@/state/session";

type TableState = { table: WithId<Table>; orders: WithId<Order>[] };

/** Only when table service is on for this outlet (pos-admin → Order modes → Table service). */
export default function TablesScreen() {
  return (
    <ModeGate mode="dineIn">
      <Tables />
    </ModeGate>
  );
}

/** Floor plan. A table's state is derived from its open orders (no stored flag to go stale). */
function Tables() {
  const { client } = usePaired();
  const { floors, tables, openOrders } = useData();
  const { size } = useBreakpoint();
  const now = useNow(30_000);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [seating, setSeating] = useState<WithId<Table> | null>(null);
  const floor = floorId ?? floors[0]?.id ?? null;

  const states = useMemo(() => {
    const byTable = new Map<string, WithId<Order>[]>();
    for (const o of openOrders) if (o.mode === "dineIn" && o.tableId) byTable.set(o.tableId, [...(byTable.get(o.tableId) ?? []), o]);
    return tables.map<TableState>((t) => ({ table: t, orders: byTable.get(t.id) ?? [] }));
  }, [tables, openOrders]);
  const visible = states.filter((s) => s.table.floorId === floor);
  const running = states.filter((s) => s.orders.some((o) => o.status === "open")).length;
  const billed = states.filter((s) => s.orders.some((o) => o.status === "billed")).length;

  function open(s: TableState) {
    if (s.orders.length === 1) return router.push(`/till/order?id=${s.orders[0]!.id}`);
    if (s.orders.length > 1) return router.push(`/till/orders`);
    if (client.modeOpts.dineIn.askCovers) setSeating(s.table);
    else router.push(`/till/order?mode=dineIn&table=${s.table.id}&label=${encodeURIComponent(s.table.label)}`);
  }

  const cols = size === "phone" ? 3 : size === "tabletP" ? 5 : 7;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {floors.map((f) => (
            <Pressable key={f.id} onPress={() => setFloorId(f.id)} accessibilityRole="tab" accessibilityState={{ selected: floor === f.id }} className={cn("min-h-11 justify-center rounded-full border px-4", floor === f.id ? "border-primary bg-primary/15" : "border-border")}>
              <Text className={floor === f.id ? "font-semibold" : ""}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text className="text-sm text-muted-foreground">
          Running {running} · Billed {billed}
        </Text>
      </View>
      {tables.length === 0 ? (
        <Text className="p-8 text-center text-muted-foreground">No tables yet. Add them in PX POS Admin → Tables.</Text>
      ) : (
        <ScrollView contentContainerClassName="flex-row flex-wrap p-2">
          {visible.map((s) => {
            const openOrder = s.orders.find((o) => o.status === "open");
            const billedOrder = s.orders.find((o) => o.status === "billed");
            const conflict = s.orders.length > 1;
            const o = openOrder ?? billedOrder;
            const total = o ? (o.bill?.grandTotalPaise ?? billFor(client, "dineIn", Object.values(o.lines)).grandTotalPaise) : 0;
            return (
              <View key={s.table.id} style={{ width: `${100 / cols}%` }} className="p-1.5">
                <Pressable
                  onPress={() => open(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`Table ${s.table.label}, ${conflict ? "needs merge" : billedOrder ? "billed" : openOrder ? "running" : "free"}`}
                  className={cn(
                    "aspect-square justify-between rounded-2xl border-2 bg-card p-3 active:bg-accent",
                    conflict ? "border-warning" : billedOrder ? "border-warning/80" : openOrder ? "border-primary" : "border-border",
                  )}
                >
                  <View className="flex-row items-start justify-between">
                    <Text className="text-2xl font-bold">{s.table.label}</Text>
                    {o?.covers ? <Text className="text-xs text-muted-foreground">{o.covers} pax</Text> : null}
                  </View>
                  {o ? (
                    <View>
                      <Text className="text-base font-semibold tabular-nums">{formatINR(total, { decimals: 0 })}</Text>
                      <Text className={cn("text-xs", conflict ? "text-warning" : billedOrder ? "text-warning" : "text-primary")}>{conflict ? "Merge required" : billedOrder ? "Billed" : `${minutesSince(o.createdAtMs, now)} min`}</Text>
                    </View>
                  ) : (
                    <Text className="text-xs text-muted-foreground">{s.table.seats} seats</Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
      <Sheet open={Boolean(seating)} onClose={() => setSeating(null)} title={`Table ${seating?.label ?? ""} — how many guests?`}>
        <View className="flex-row flex-wrap gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              variant="outline"
              size="lg"
              className="w-[22%] grow"
              onPress={() => {
                const t = seating!;
                setSeating(null);
                router.push(`/till/order?mode=dineIn&table=${t.id}&label=${encodeURIComponent(t.label)}&covers=${n}`);
              }}
            >
              <Text className="text-xl">{n}</Text>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="lg"
            className="w-full"
            onPress={() => {
              const t = seating!;
              setSeating(null);
              router.push(`/till/order?mode=dineIn&table=${t.id}&label=${encodeURIComponent(t.label)}`);
            }}
          >
            <Text>Skip</Text>
          </Button>
        </View>
      </Sheet>
    </View>
  );
}
