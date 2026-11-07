import { useState } from "react";
import { View } from "react-native";
import type { OrderLine } from "@px-pos/core";
import { Keypad } from "@/components/pos/keypad";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

const MAX_QTY = 999;

/**
 * Type how many of a line (50 coffees in four taps, not fifty). Starts empty with the current
 * quantity shown greyed; 0 takes the line off the ticket.
 */
export function QtySheet({ line, onClose, onSet }: { line: OrderLine | null; onClose: () => void; onSet: (qty: number) => void }) {
  const [text, setText] = useState("");
  const [seen, setSeen] = useState(line?.lineId);
  if (seen !== line?.lineId) {
    setSeen(line?.lineId);
    setText("");
  }
  const key = (k: string) =>
    setText((t) => {
      if (k === "⌫") return t.slice(0, -1);
      const next = (t === "0" ? "" : t) + k;
      return Number(next) > MAX_QTY ? t : next.replace(/^0+(?=\d)/, "");
    });
  const qty = text === "" ? null : Number(text);
  const name = line ? `${line.name}${line.variantName ? ` (${line.variantName})` : ""}` : "";
  return (
    <Sheet
      open={Boolean(line)}
      onClose={onClose}
      title={`How many ${name}?`}
      footer={
        <>
          <Button variant="outline" onPress={onClose} accessibilityLabel="Cancel">
            <Text>Cancel</Text>
          </Button>
          <Button
            variant={qty === 0 ? "destructive" : "default"}
            disabled={qty == null}
            onPress={() => {
              if (qty == null) return;
              onSet(qty);
              onClose();
            }}
            accessibilityLabel={qty === 0 ? `Remove ${name}` : `Set ${qty ?? ""} ${name}`}
          >
            <Text>{qty === 0 ? "Remove" : qty == null ? "Set" : `Set ${qty}`}</Text>
          </Button>
        </>
      }
    >
      <View className="gap-4">
        <View className="h-16 items-center justify-center rounded-xl border border-border bg-card" accessibilityLiveRegion="polite">
          <Text className={cn("text-4xl font-bold tabular-nums", qty == null && "text-muted-foreground")} accessibilityLabel={qty == null ? `Now ${line?.qty ?? 0}` : `${qty}`}>
            {qty == null ? String(line?.qty ?? "") : text}
          </Text>
        </View>
        <Keypad onKey={key} allowDot={false} />
      </View>
    </Sheet>
  );
}
