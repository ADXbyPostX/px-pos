import { Pressable, View } from "react-native";
import { Ban, Trash2 } from "lucide-react-native";
import { formatINR, type Paise } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";

/** Sits to the right of Pay: throws away an order that hasn't been sent or paid. */
export function VoidButton({ onPress, size = "xl" }: { onPress: () => void; size?: "lg" | "xl" }) {
  return (
    <Button size={size} variant="destructive" onPress={onPress} accessibilityLabel="Void this order" className="px-4">
      <Ban color={colors.red} size={20} />
      <Text>Void</Text>
    </Button>
  );
}

/** Square twin of the Hold button (menu cart bar, right side): empties the cart. */
export function ClearButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Clear the cart" className="h-14 w-14 items-center justify-center rounded-xl border border-border bg-card active:bg-accent">
      <Trash2 color={colors.foreground} size={22} />
    </Pressable>
  );
}

const COPY = {
  void: { title: "Void this order?", what: "will be cleared", confirm: "Void order", Icon: Ban },
  clear: { title: "Clear the cart?", what: "will be removed from the cart", confirm: "Clear items", Icon: Trash2 },
} as const;

/**
 * "Are you sure?" before a void or a clear. Nothing was sent to the kitchen or charged,
 * so the items just disappear (Void also starts a fresh order).
 */
export function VoidSheet({ kind, open, onClose, onConfirm, items, totalPaise }: { kind: "void" | "clear"; open: boolean; onClose: () => void; onConfirm: () => void; items: number; totalPaise: Paise }) {
  const c = COPY[kind];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={c.title}
      footer={
        <>
          <Button variant="outline" onPress={onClose}>
            <Text>Keep order</Text>
          </Button>
          <Button onPress={onConfirm} accessibilityLabel={`Confirm: ${c.confirm}`}>
            <c.Icon color="#fff" size={18} />
            <Text>{c.confirm}</Text>
          </Button>
        </>
      }
    >
      <View className="gap-2">
        <Text className="text-lg">
          {items} item{items === 1 ? "" : "s"} · {formatINR(totalPaise, { decimals: "auto" })} {c.what}.
        </Text>
        <Text className="text-muted-foreground">Nothing has been sent to the kitchen or paid yet, so no bill is affected.</Text>
      </View>
    </Sheet>
  );
}
