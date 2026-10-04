import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { BrandImage } from "@/components/pos/brand-image";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useSession } from "@/state/session";

export default function Revoked() {
  const { unpair } = useSession();
  const [blocked, setBlocked] = useState(false);
  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background px-10">
      <BrandImage kind="short" width={220} />
      <Text className="text-center text-3xl font-bold">This terminal was removed</Text>
      <Text className="max-w-2xl text-center text-lg text-muted-foreground">An admin removed this device from its outlet. Pair it again to use it as a new terminal.</Text>
      <Button
        size="lg"
        onPress={() => {
          if (unpair()) router.replace("/pair");
          else setBlocked(true);
        }}
      >
        <Text>Pair again</Text>
      </Button>
      {blocked ? <Text className="text-primary">Some sales haven&apos;t synced yet. Connect to the internet first.</Text> : null}
    </View>
  );
}
