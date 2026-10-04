import { useEffect } from "react";
import { useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { BrandImage } from "@/components/pos/brand-image";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useSession } from "@/state/session";

/** Unpaired tablet: show the code the admin types into PX POS Admin → Terminals → Pair terminal. */
export default function Pair() {
  const { session, newCode } = useSession();
  const { width } = useWindowDimensions();
  useEffect(() => {
    if (session.status === "paired") router.replace("/till");
  }, [session.status]);
  const code = session.status === "unpaired" ? session.code : null;
  const rejected = session.status === "unpaired" && session.request?.status === "rejected";
  return (
    <View className="flex-1 items-center justify-center gap-10 bg-background px-6">
      <BrandImage width={Math.min(420, width - 48)} />
      <View className="items-center gap-3">
        <Text className="text-center text-xl text-muted-foreground">Pair this terminal in PX POS Admin → Terminals</Text>
        {/* text-7xl sets line-height = font size, which clips the glyph tops on Android. */}
        <Text className="font-mono text-7xl leading-[92px] font-bold tracking-widest" numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Pairing code ${code ?? "loading"}`} selectable>
          {code ?? "········"}
        </Text>
        {rejected ? <Text className="text-lg text-primary">This request was rejected.</Text> : <Text className="text-base text-muted-foreground">Waiting for an admin…</Text>}
      </View>
      <Button variant="outline" onPress={() => void newCode()}>
        <Text>Get a new code</Text>
      </Button>
    </View>
  );
}
