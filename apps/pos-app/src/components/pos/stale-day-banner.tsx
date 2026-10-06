import { View } from "react-native";
import { useRouter } from "expo-router";
import { bizDateLabel } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useData } from "@/state/data";

/**
 * The open business day is behind the calendar (nobody closed it): every sale still goes to that
 * old day. A strip across the till until someone runs End of day.
 */
export function StaleDayBanner() {
  const router = useRouter();
  const { bizDate, suggestedBizDate, day } = useData();
  if (!bizDate || day?.status === "closed" || bizDate >= suggestedBizDate) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/15 px-4 py-2">
      <Text className="min-w-48 flex-1 text-base text-warning">
        Business day {bizDateLabel(bizDate)} is still open. Sales go to that day until it&apos;s closed.
      </Text>
      <Button size="sm" variant="outline" onPress={() => router.push({ pathname: "/till/day", params: { close: "1" } })} accessibilityLabel={`Close business day ${bizDateLabel(bizDate)}`}>
        <Text>End of day</Text>
      </Button>
    </View>
  );
}
