import { View } from "react-native";
import type { FoodType } from "@px-pos/core";
import { cn } from "@/lib/utils";

/** Indian veg / non-veg / egg symbol. */
export function FoodMark({ type, className }: { type: FoodType; className?: string }) {
  const color = type === "veg" ? "border-success" : type === "egg" ? "border-warning" : "border-primary";
  const dot = type === "veg" ? "bg-success" : type === "egg" ? "bg-warning" : "bg-primary";
  return (
    <View accessibilityLabel={type === "veg" ? "Veg" : type === "egg" ? "Egg" : "Non-veg"} className={cn("h-3.5 w-3.5 items-center justify-center rounded-[3px] border", color, className)}>
      <View className={cn("h-1.5 w-1.5 rounded-full", dot)} />
    </View>
  );
}
