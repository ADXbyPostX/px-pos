import { Pressable, View } from "react-native";
import { Delete } from "lucide-react-native";
import { Text } from "@/components/ui/text";

/**
 * Big-touch numeric keypad for amounts (rupees) and counts. `fill` stretches the four rows
 * over the height its parent gives it (between 48 and 80 dp a row), so a screen never scrolls.
 * `pin` leaves the bottom-left key empty (no "." or "00" in a PIN).
 */
export function Keypad({ onKey, allowDot = true, fill = false, pin = false }: { onKey: (k: string) => void; allowDot?: boolean; fill?: boolean; pin?: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", pin ? "" : allowDot ? "." : "00", "0", "⌫"];
  const key = (k: string, className: string) =>
    k === "" ? (
      <View key="blank" className="flex-1" />
    ) : (
      <Pressable key={k} onPress={() => onKey(k)} accessibilityRole="button" accessibilityLabel={k === "⌫" ? "Delete" : k} className={className}>
        {k === "⌫" ? <Delete color="#fafafa" size={26} /> : <Text className="text-3xl font-semibold">{k}</Text>}
      </Pressable>
    );
  if (fill) {
    return (
      <View className="flex-1 justify-center gap-2">
        {[0, 3, 6, 9].map((i) => (
          <View key={i} className="max-h-20 min-h-12 flex-1 flex-row gap-2">
            {keys.slice(i, i + 3).map((k) => key(k, "flex-1 items-center justify-center rounded-xl border border-border bg-card active:bg-accent"))}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-2">
      {keys.map((k) =>
        k === "" ? (
          <View key="blank" className="h-16 grow basis-[30%]" />
        ) : (
          <Pressable
            key={k}
            onPress={() => onKey(k)}
            accessibilityRole="button"
            accessibilityLabel={k === "⌫" ? "Delete" : k}
            className="h-16 grow basis-[30%] items-center justify-center rounded-lg border border-border bg-card active:bg-accent"
          >
            {k === "⌫" ? <Delete color="#fafafa" size={24} /> : <Text className="text-2xl font-semibold">{k}</Text>}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** Apply a keypad key to a rupee text value ("120.5"). */
export function applyKey(value: string, k: string, maxDecimals = 2): string {
  if (k === "⌫") return value.slice(0, -1);
  if (k === ".") return value.includes(".") ? value : `${value || "0"}.`;
  const [, dec] = value.split(".");
  if (dec != null && dec.length >= maxDecimals) return value;
  if (value === "0" && k !== ".") return k === "00" ? "0" : k;
  return (value + k).slice(0, 9);
}
