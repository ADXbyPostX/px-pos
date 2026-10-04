import { View } from "react-native";
import { Redirect } from "expo-router";
import { Text } from "@/components/ui/text";
import { usePaired } from "@/state/session";

/** Till home: the first order mode the admin switched on for this outlet. */
export default function TillHome() {
  const { client } = usePaired();
  if (client.orderModes.dineIn) return <Redirect href="/till/tables" />;
  if (client.orderModes.quick) return <Redirect href="/till/order?mode=quick" />;
  if (client.orderModes.delivery) return <Redirect href="/till/delivery" />;
  return (
    <View className="flex-1 items-center justify-center p-8">
      <Text className="max-w-md text-center text-lg text-muted-foreground">No order types are switched on for this outlet yet. An admin can turn on table service, quick orders or delivery in PX POS Admin.</Text>
    </View>
  );
}
