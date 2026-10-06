import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { bizDateLabel, cashStats, collected, expectedCashFor, formatINR, MODE_LABEL, netSales, np, VOID_REASONS, type OrderMode } from "@px-pos/core";
import { EndOfDay } from "@/components/pos/end-of-day";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";

const PAY_LABEL: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", other: "Other" };
const rs = (p: number) => formatINR(p, { decimals: "auto" });

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <View className={cn("rounded-2xl border border-border bg-card", className)}>
      <Text className="border-b border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground">{title}</Text>
      <View className="gap-1.5 px-4 py-3">{children}</View>
    </View>
  );
}

/** `sub` = a breakdown line under the row above it (indented, smaller). */
function Row({ label, value, strong = false, tone, sub = false }: { label: string; value: string; strong?: boolean; tone?: "warning" | "success"; sub?: boolean }) {
  return (
    <View className={cn("flex-row items-center justify-between gap-3", sub && "pl-4")}>
      <Text className={cn(strong ? "text-lg font-bold" : sub ? "text-sm text-muted-foreground" : "text-base text-muted-foreground")}>{label}</Text>
      <Text className={cn("tabular-nums", strong ? "text-lg font-bold" : sub ? "text-sm text-muted-foreground" : "text-base", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-36 flex-1 rounded-2xl border border-border bg-card px-4 py-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-2xl font-bold tabular-nums" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** Today (X report, live) and this terminal's drawer; End of day counts the cash and closes it (Z). */
export default function Day() {
  // ?close=1 comes from the "still open" banner: straight to End of day.
  const params = useLocalSearchParams<{ close?: string }>();
  const router = useRouter();
  const [closingState, setClosing] = useState(false);
  const closing = closingState || params.close === "1";
  const { tid } = usePaired();
  const { bizDate, day, drawer, stats, openOrders } = useData();
  const { operator } = useOperator();
  const { size } = useBreakpoint();
  const s = stats ?? undefined;
  const cash = cashStats(s?.cash?.[tid]);
  const float = drawer?.openingFloatPaise ?? 0;
  const expected = expectedCashFor(float, cash);
  const mine = operator ? s?.byStaff?.[operator.id] : undefined;
  const tax = (s?.cgstPaise ?? 0) + (s?.sgstPaise ?? 0);
  const disc = (s?.itemDiscPaise ?? 0) + (s?.billDiscPaise ?? 0);
  const voids = np(s?.voidItems);
  const voidReasons = Object.entries(s?.voidByReason ?? {}).map(([k, v]) => [VOID_REASONS.find((r) => r.key === k)?.label ?? k, np(v)] as const);
  const modes = Object.entries(s?.byMode ?? {}).map(([k, v]) => [k, np(v)] as const);
  const pays = Object.entries(s?.byPay ?? {});

  if (closing && day?.status !== "closed") return <EndOfDay
        onCancel={() => {
          setClosing(false);
          router.setParams({ close: "" });
        }}
      />;

  return (
    <ScrollView contentContainerClassName="gap-3 p-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2 px-1">
        <View className="flex-row items-baseline gap-3">
          <Text className="text-xl font-bold">{bizDate ? bizDateLabel(bizDate, true) : "Today"}</Text>
          <Text className={cn("text-sm font-semibold", day?.status === "closed" ? "text-warning" : "text-success")}>{day?.status === "closed" ? `Closed · Z ${day.zNo ?? ""}` : "Open"}</Text>
        </View>
        {day?.status !== "closed" ? (
          <Button variant="destructive" onPress={() => setClosing(true)} accessibilityLabel="End of day">
            <Text>End of day</Text>
          </Button>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Stat label="Orders" value={String(s?.orders ?? 0)} />
        <Stat label="Net sales" value={rs(netSales(s))} />
        <Stat label="Collected" value={rs(collected(s))} />
        <Stat label="Running" value={String(openOrders.length)} />
      </View>
      <View className={cn("gap-3", size !== "phone" && "flex-row items-start")}>
        <View className="flex-1 gap-3">
          <Panel title="Sales (X report)">
            <Row label="Gross" value={rs(s?.grossPaise ?? 0)} />
            <Row label="Discounts" value={disc ? `-${rs(disc)}` : rs(0)} />
            <Row label="Charges" value={rs(s?.chargesPaise ?? 0)} />
            <Row label="GST (CGST + SGST)" value={rs(tax)} />
            <Row label="Round off" value={rs(s?.roundOffPaise ?? 0)} />
            <Row label="Total billed" value={rs(s?.totalPaise ?? 0)} strong />
            <Row label="Tips" value={rs(s?.tipsPaise ?? 0)} />
            <Row label={`Voided items (${voids.n})`} value={rs(voids.paise)} tone={voids.n ? "warning" : undefined} />
            {voidReasons.map(([label, v]) => (
              <Row key={label} label={`${label} (${v.n})`} value={rs(v.paise)} sub />
            ))}
          </Panel>
          <Panel title="Payments">
            {pays.length === 0 ? <Text className="text-muted-foreground">No payments yet</Text> : pays.map(([k, v]) => <Row key={k} label={PAY_LABEL[k] ?? k} value={rs(v)} />)}
          </Panel>
          <Panel title="Order types">
            {modes.length === 0 ? <Text className="text-muted-foreground">No settled orders yet</Text> : modes.map(([k, v]) => <Row key={k} label={`${MODE_LABEL[k as OrderMode] ?? k} (${v.n})`} value={rs(v.paise)} />)}
          </Panel>
        </View>
        <View className="flex-1 gap-3">
          <Panel title="My drawer">
            <Row label="Opening float" value={rs(float)} />
            <Row label="Cash sales" value={rs(cash.sales)} />
            <Row label="Refunds" value={cash.refunds ? `-${rs(cash.refunds)}` : rs(0)} />
            <Row label="Paid in" value={rs(cash.paidIn)} />
            <Row label="Paid out" value={cash.paidOut ? `-${rs(cash.paidOut)}` : rs(0)} />
            <Row label="Drops" value={cash.drops ? `-${rs(cash.drops)}` : rs(0)} />
            <Row label="Expected in drawer" value={rs(expected)} strong tone="success" />
          </Panel>
          {operator ? (
            <Panel title={`${operator.name} today`}>
              <Row label="Orders" value={String(mine?.n ?? 0)} />
              <Row label="Net sales" value={rs(mine?.net ?? 0)} />
              <Row label="Discounts given" value={rs(mine?.disc ?? 0)} />
              <Row label="Voids" value={String(mine?.voids ?? 0)} />
            </Panel>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
