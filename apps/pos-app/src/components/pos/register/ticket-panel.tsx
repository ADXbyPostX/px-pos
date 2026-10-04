import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ChevronLeft, Minus, Plus } from "lucide-react-native";
import { formatINR, halfRateLabel, type BillResult, type Order, type OrderLine } from "@px-pos/core";
import { Text } from "@/components/ui/text";
import type { WithId } from "@/hooks/use-live";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";

function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={cn(strong ? "text-2xl font-bold" : "text-base", muted && "text-muted-foreground")}>{label}</Text>
      <Text className={cn("tabular-nums", strong ? "text-2xl font-bold" : "text-base", muted && "text-muted-foreground")}>{value}</Text>
    </View>
  );
}

/** Live totals exactly as the bill will print (computeBill from @px-pos/core). */
export function TotalsBlock({ bill }: { bill: BillResult }) {
  const fmt = (p: number) => formatINR(p);
  // Tax-inclusive menus: GST is inside the item prices, so show the taxable value it's backed out of
  // (taxable + GST + round off = total, exactly as the printed bill).
  const incl = bill.priceMode === "inclusive" && bill.taxes.some((t) => t.bps > 0);
  return (
    <View className="gap-1.5 border-t border-border px-4 py-3">
      <Row label={`Items (${bill.itemQty})${incl ? " incl. GST" : ""}`} value={fmt(bill.grossPaise)} muted />
      {bill.itemDiscPaise + bill.billDiscPaise > 0 ? <Row label="Discount" value={`-${fmt(bill.itemDiscPaise + bill.billDiscPaise)}`} muted /> : null}
      {bill.charges.map((c) => (
        <Row key={c.kind} label={c.kind === "packaging" ? "Packaging" : c.kind === "delivery" ? "Delivery" : "Service charge"} value={fmt(c.amountPaise)} muted />
      ))}
      {incl ? <Row label="Taxable value" value={fmt(bill.taxablePaise)} muted /> : null}
      {bill.taxes
        .filter((t) => t.bps > 0)
        .map((t) => (
          <Row key={t.bps} label={`GST ${halfRateLabel(t.bps)} + ${halfRateLabel(t.bps)}`} value={fmt(t.cgstPaise + t.sgstPaise)} muted />
        ))}
      {bill.roundOffPaise ? <Row label="Round off" value={`${bill.roundOffPaise > 0 ? "+" : ""}${fmt(bill.roundOffPaise)}`} muted /> : null}
      <Row label="Total" value={formatINR(bill.grandTotalPaise, { decimals: "auto" })} strong />
    </View>
  );
}

function SentLine({ l }: { l: OrderLine }) {
  const active = l.qty - l.voidedQty;
  return (
    <View className="flex-row items-center gap-3 px-4 py-2 opacity-80">
      <Text className="w-8 text-center text-muted-foreground">{active}×</Text>
      <View className="flex-1">
        <Text className={cn("text-base", active === 0 && "text-muted-foreground line-through")} numberOfLines={1}>
          {l.name}
          {l.variantName ? ` (${l.variantName})` : ""}
        </Text>
        {l.note ? <Text className="text-xs text-muted-foreground">{l.note}</Text> : null}
      </View>
      <Text className="text-xs text-muted-foreground">sent</Text>
      <Text className="w-20 text-right tabular-nums text-muted-foreground">{formatINR(l.unitPricePaise * active, { decimals: "auto" })}</Text>
    </View>
  );
}

function DraftLine({ l, onQty }: { l: OrderLine; onQty: (qty: number) => void }) {
  return (
    <View className="flex-row items-center gap-2 border-l-4 border-primary py-1.5 pr-3 pl-3">
      <View className="flex-1">
        <Text className="text-base font-medium" numberOfLines={2}>
          {l.name}
          {l.variantName ? ` (${l.variantName})` : ""}
        </Text>
        {l.note ? <Text className="text-xs text-warning">{l.note}</Text> : null}
      </View>
      <Pressable onPress={() => onQty(l.qty - 1)} accessibilityLabel={`One less ${l.name}`} className="h-11 w-11 items-center justify-center rounded-lg border border-border active:bg-accent">
        <Minus color={colors.foreground} size={20} />
      </Pressable>
      <Text className="w-8 text-center text-lg font-semibold tabular-nums">{l.qty}</Text>
      <Pressable onPress={() => onQty(l.qty + 1)} accessibilityLabel={`One more ${l.name}`} className="h-11 w-11 items-center justify-center rounded-lg border border-border active:bg-accent">
        <Plus color={colors.foreground} size={20} />
      </Pressable>
      <Text className="w-20 text-right tabular-nums">{formatINR(l.unitPricePaise * l.qty, { decimals: "auto" })}</Text>
    </View>
  );
}

/** The right-hand ticket: header, sent lines, new lines, live totals and the action bar. */
export function TicketPanel({
  title,
  subtitle,
  order,
  lines,
  bill,
  onQty,
  actions,
  className,
  onBack,
  headerAction,
}: {
  title: string;
  subtitle?: string;
  order: WithId<Order> | null;
  lines: OrderLine[];
  bill: BillResult;
  onQty: (lineId: string, qty: number) => void;
  actions: ReactNode;
  className?: string;
  /** Phones: the ticket is a full screen over the menu; this returns to it. */
  onBack?: () => void;
  /** Right side of the header (e.g. Hold). */
  headerAction?: ReactNode;
}) {
  const sent = order ? Object.values(order.lines).sort((a, b) => a.seq - b.seq) : [];
  const empty = sent.length === 0 && lines.length === 0;
  return (
    <View className={cn("border-l border-border bg-card", className)}>
      <View className="flex-row items-center gap-1 border-b border-border py-3 pr-4 pl-4">
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to menu" className="-ml-2 h-11 w-11 items-center justify-center rounded-lg active:bg-accent">
            <ChevronLeft color={colors.foreground} size={26} />
          </Pressable>
        ) : null}
        <View className="flex-1">
          <Text className="text-xl font-bold" accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text className="text-sm text-muted-foreground">{subtitle}</Text> : null}
        </View>
        {headerAction}
      </View>
      <ScrollView className="flex-1" contentContainerClassName="py-2">
        {empty ? <Text className="px-4 py-8 text-center text-muted-foreground">Tap dishes to add them</Text> : null}
        {sent.map((l) => (
          <SentLine key={l.lineId} l={l} />
        ))}
        {sent.length > 0 && lines.length > 0 ? <Text className="px-4 pt-3 pb-1 text-xs font-semibold text-primary">NEW — NOT SENT YET</Text> : null}
        {lines.map((l) => (
          <DraftLine key={l.lineId} l={l} onQty={(q) => onQty(l.lineId, q)} />
        ))}
      </ScrollView>
      <TotalsBlock bill={bill} />
      <View className="gap-2 border-t border-border p-3">{actions}</View>
    </View>
  );
}
