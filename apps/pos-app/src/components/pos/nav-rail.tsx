import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Lock } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { useTillNav } from "@/hooks/use-till-nav";
import { useOperator } from "@/state/operator";
import { BrandImage } from "./brand-image";
import { SyncPill } from "./sync-pill";

/** 80dp rail on tablets: order modes the admin enabled, running orders, kitchen, day, lock. */
export function NavRail() {
  const { operator, lock } = useOperator();
  const entries = useTillNav();
  return (
    <View className="w-20 items-center justify-between border-r border-border bg-card py-3">
      <View className="items-center gap-1">
        <BrandImage kind="mark" width={40} />
        <Text className="mb-2 text-[10px] text-muted-foreground" numberOfLines={1}>
          {operator?.name.split(" ")[0]}
        </Text>
        {entries.map((e) => (
          <Pressable key={e.label} onPress={() => router.replace(e.href)} accessibilityRole="tab" accessibilityState={{ selected: e.active }} accessibilityLabel={e.label} className={cn("h-16 w-16 items-center justify-center gap-1 rounded-xl", e.active ? "bg-primary/15" : "active:bg-accent")}>
            <e.Icon color={e.active ? colors.red : colors.foreground} size={24} />
            <Text className={cn("text-[11px]", e.active ? "font-semibold text-primary" : "text-muted-foreground")}>{e.label}</Text>
            {e.badge ? (
              <View className="absolute top-1 right-1 min-w-5 items-center rounded-full bg-primary px-1">
                <Text className="text-[11px] font-bold text-white">{e.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <View className="items-center gap-2">
        <SyncPill compact />
        <Pressable onPress={lock} accessibilityLabel="Lock (switch user)" className="h-14 w-14 items-center justify-center rounded-xl active:bg-accent">
          <Lock color={colors.muted} size={22} />
        </Pressable>
      </View>
    </View>
  );
}
