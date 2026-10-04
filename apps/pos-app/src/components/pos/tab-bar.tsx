import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lock } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { useTillNav } from "@/hooks/use-till-nav";
import { useOperator } from "@/state/operator";

/** Phones: bottom tabs (the tablet rail doesn't fit a 400dp-wide screen). */
export function TabBar() {
  const { lock } = useOperator();
  const insets = useSafeAreaInsets();
  const entries = useTillNav();
  return (
    <View className="flex-row border-t border-border bg-card" style={{ paddingBottom: insets.bottom }}>
      {entries.map((e) => (
        <Pressable key={e.label} onPress={() => router.replace(e.href)} accessibilityRole="tab" accessibilityState={{ selected: e.active }} accessibilityLabel={e.label} className="h-16 flex-1 items-center justify-center gap-1">
          <e.Icon color={e.active ? colors.red : colors.foreground} size={22} />
          <Text className={cn("text-[11px]", e.active ? "font-semibold text-primary" : "text-muted-foreground")}>{e.label}</Text>
          {e.badge ? (
            <View className="absolute top-1.5 right-3 min-w-5 items-center rounded-full bg-primary px-1">
              <Text className="text-[11px] font-bold text-white">{e.badge}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
      <Pressable onPress={lock} accessibilityLabel="Lock (switch user)" className="h-16 w-14 items-center justify-center">
        <Lock color={colors.muted} size={20} />
      </Pressable>
    </View>
  );
}
