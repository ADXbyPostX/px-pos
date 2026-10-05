import { Pressable, ScrollView, View } from "react-native";
import type { Category } from "@px-pos/core";
import { Text } from "@/components/ui/text";
import type { WithId } from "@/hooks/use-live";
import { cn } from "@/lib/utils";

/**
 * Category chips across the top (`horizontal`) or a list down the left. The list is `width` dp
 * wide (the register sizes it to the screen); counts show only when there's room for them.
 */
export function CategoryRail({ categories, value, onChange, horizontal = false, counts, width = 184 }: { categories: WithId<Category>[]; value: string; onChange: (id: string) => void; horizontal?: boolean; counts: Map<string, number>; width?: number }) {
  const all = [{ id: "all", name: "All" }, ...categories];
  if (horizontal) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="shrink-0 grow-0" contentContainerClassName="gap-2 px-3 py-2">
        {all.map((c) => (
          <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityRole="tab" accessibilityLabel={c.name} accessibilityState={{ selected: value === c.id }} className={cn("min-h-11 justify-center rounded-full border px-4", value === c.id ? "border-primary bg-primary/15" : "border-border")}>
            <Text className={cn("text-base", value === c.id && "font-semibold")}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }
  return (
    <ScrollView style={{ width }} className="shrink-0 grow-0 border-r border-border" contentContainerClassName="py-2">
      {all.map((c) => {
        const active = value === c.id;
        return (
          <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityRole="tab" accessibilityLabel={c.name} accessibilityState={{ selected: active }} className={cn("min-h-14 flex-row items-center gap-2 pr-2 active:bg-accent", width >= 160 ? "pl-3" : "pl-1.5", active && "bg-accent")}>
            <View className={cn("h-7 w-1 rounded-full", active ? "bg-primary" : "bg-transparent")} />
            <Text numberOfLines={3} className={cn("flex-1 text-base leading-5", active ? "font-semibold" : "text-muted-foreground")}>
              {c.name}
            </Text>
            {width >= 150 && c.id !== "all" && counts.get(c.id) ? <Text className="text-xs text-muted-foreground">{counts.get(c.id)}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
