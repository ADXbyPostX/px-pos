import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { PauseCircle, Trash2 } from "lucide-react-native";
import { formatINR, minutesSince, type Paise } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useNow } from "@/hooks/use-live";
import type { HeldTicket } from "@/local/held";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** Opens the hold sheet; the badge counts orders already on hold. */
export function HoldButton({ count, onPress, square = false }: { count: number; onPress: () => void; square?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count ? `Hold, ${count} on hold` : "Hold"}
      className={cn("flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-card active:bg-accent", square ? "h-14 w-14" : "h-11 px-3")}
    >
      <PauseCircle color={colors.foreground} size={square ? 24 : 20} />
      {square ? null : <Text className="text-sm font-semibold">Hold</Text>}
      {count ? (
        <View className={cn("min-w-5 items-center rounded-full bg-primary px-1", square ? "absolute -top-1.5 -right-1.5" : "")}>
          <Text className="text-[11px] font-bold text-white">{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** "Masala Chai, Bun Maska +2" — what a held ticket is, when nobody named it. */
export function ticketSummary(t: Pick<HeldTicket, "lines">): string {
  const names = t.lines.map((l) => l.name);
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/**
 * Hold (park) the ticket on screen while the customer decides, and bring held ones back.
 * `current` is null when the ticket on screen can't be held (empty, or already sent/billed).
 */
export function HeldSheet({
  open,
  onClose,
  current,
  held,
  totalOf,
  onHold,
  onResume,
  onDiscard,
}: {
  open: boolean;
  onClose: () => void;
  current: { items: number; totalPaise: Paise; suggested?: string } | null;
  held: HeldTicket[];
  totalOf: (t: HeldTicket) => Paise;
  onHold: (label: string) => void;
  onResume: (t: HeldTicket) => void;
  onDiscard: (t: HeldTicket) => void;
}) {
  const now = useNow(30_000);
  const [label, setLabel] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const close = () => {
    setLabel("");
    setConfirming(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={current ? "Hold this order" : `Held orders (${held.length})`}>
      <View className="gap-4">
        {current ? (
          <View className="gap-3">
            <Text className="text-muted-foreground">
              {current.items} item{current.items === 1 ? "" : "s"} · {formatINR(current.totalPaise, { decimals: "auto" })}
            </Text>
            <View className="flex-row gap-2">
              <Input value={label} onChangeText={setLabel} placeholder={current.suggested ?? "Name or table (optional)"} autoCapitalize="words" maxLength={24} returnKeyType="done" onSubmitEditing={() => onHold(label)} className="flex-1" accessibilityLabel="Name for the held order" />
              <Button size="lg" onPress={() => {
                onHold(label);
                setLabel("");
              }}>
                <PauseCircle color="#fff" size={20} />
                <Text>Hold</Text>
              </Button>
            </View>
          </View>
        ) : null}

        {current && held.length ? <Text className="pt-1 text-sm font-semibold text-muted-foreground">On hold ({held.length})</Text> : null}
        {held.length === 0 && !current ? <Text className="py-6 text-center text-muted-foreground">No orders on hold</Text> : null}

        <ScrollView className="max-h-96" contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
          {held.map((t) => {
            const name = t.held?.label ?? t.customer?.name;
            return (
              <View key={t.id} className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-2 pl-3">
                <Pressable onPress={() => onResume(t)} accessibilityRole="button" accessibilityLabel={`Resume ${name ?? ticketSummary(t)}`} className="min-h-12 flex-1 justify-center active:opacity-70">
                  <Text className="text-base font-semibold" numberOfLines={1}>
                    {name ?? ticketSummary(t)}
                  </Text>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {t.mode === "delivery" ? "Delivery · " : ""}
                    {name ? `${ticketSummary(t)} · ` : ""}
                    {formatINR(totalOf(t), { decimals: "auto" })} · {t.parked ? "held" : "not finished"} {minutesSince(t.sinceMs, now)} min
                  </Text>
                </Pressable>
                {confirming === t.id ? (
                  <Button size="sm" variant="destructive" onPress={() => onDiscard(t)} accessibilityLabel={`Discard ${name ?? ticketSummary(t)}`}>
                    <Text>Discard</Text>
                  </Button>
                ) : (
                  <Pressable onPress={() => setConfirming(t.id)} accessibilityRole="button" accessibilityLabel={`Remove ${name ?? ticketSummary(t)}`} className="h-11 w-11 items-center justify-center rounded-lg active:bg-accent">
                    <Trash2 color={colors.muted} size={18} />
                  </Pressable>
                )}
                <Button size="sm" variant="secondary" onPress={() => onResume(t)} className={cn(confirming === t.id && "hidden")}>
                  <Text>Resume</Text>
                </Button>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Sheet>
  );
}
