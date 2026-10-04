import { Pressable, ScrollView, View } from "react-native";
import type { Category } from "@px-pos/core";
import { Text } from "@/components/ui/text";
import type { WithId } from "@/hooks/use-live";
import { cn } from "@/lib/utils";

/** Vertical category list (tablet) or horizontal chips (phone / portrait). */
export function CategoryRail({ categories, value, onChange, horizontal = false, counts }: { categories: WithId<Category>[]; value: string; onChange: (id: string) => void; horizontal?: boolean; counts: Map<string, number> }) {
  const all = [{ id: "all", name: "All" }, ...categories];
  if (horizontal) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="shrink-0 grow-0" contentContainerClassName="gap-2 px-3 py-2">
        {all.map((c) => (
          <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityRole="tab" accessibilityState={{ selected: value === c.id }} className={cn("min-h-11 justify-center rounded-full border px-4", value === c.id ? "border-primary bg-primary/15" : "border-border")}>
            <Text className={cn("text-base", value === c.id && "font-semibold")}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }
  return (
    <ScrollView className="w-[184px] border-r border-border" contentContainerClassName="py-2">
      {all.map((c) => {
        const active = value === c.id;
        return (
          <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityRole="tab" accessibilityState={{ selected: active }} className={cn("min-h-14 flex-row items-center gap-3 px-4 active:bg-accent", active && "bg-accent")}>
            <View className={cn("h-7 w-1 rounded-full", active ? "bg-primary" : "bg-transparent")} />
            <Text numberOfLines={2} className={cn("flex-1 text-base", active ? "font-semibold" : "text-muted-foreground")}>
              {c.name}
            </Text>
            {c.id !== "all" && counts.get(c.id) ? <Text className="text-xs text-muted-foreground">{counts.get(c.id)}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
