import { useEffect } from "react";
import { View } from "react-native";
import { Redirect, Slot } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandImage } from "@/components/pos/brand-image";
import { SyncPill } from "@/components/pos/sync-pill";
import { TabBar } from "@/components/pos/tab-bar";
import { Text } from "@/components/ui/text";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { LockScreen } from "@/components/pos/lock-screen";
import { NavRail } from "@/components/pos/nav-rail";
import { OpenDay } from "@/components/pos/open-day";
import { StaleDayBanner } from "@/components/pos/stale-day-banner";
import { useCheckoutFocus } from "@/state/checkout-focus";
import { DataProvider, useData } from "@/state/data";
import { OperatorProvider, useOperator } from "@/state/operator";
import { customerDisplay } from "@/hardware/customer-display";
import { usePaired, useSession } from "@/state/session";
import { SyncProvider } from "@/state/sync";

function TillGate() {
  const { client } = usePaired();
  const { operator, touch } = useOperator();
  // The customer display greets with the outlet's name until a ticket starts.
  useEffect(() => {
    customerDisplay.setOutlet(client.name);
    customerDisplay.idle();
  }, [client.name]);
  const { bizDate, day } = useData();
  const { size } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const paying = useCheckoutFocus();
  if (!operator) return <LockScreen />;
  if (!bizDate || day?.status === "closed") return <OpenDay />;
  if (size === "phone") {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }} onTouchStart={touch}>
        <View className="h-14 flex-row items-center gap-3 border-b border-border px-4">
          <BrandImage kind="short" width={72} />
          <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
            {operator.name}
          </Text>
          <SyncPill />
        </View>
        <StaleDayBanner />
        <View className="flex-1">
          <Slot />
        </View>
        {paying ? <View style={{ height: insets.bottom }} /> : <TabBar />}
      </View>
    );
  }
  return (
    <View className="flex-1 flex-row bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} onTouchStart={touch}>
      <NavRail />
      <View className="flex-1">
        <StaleDayBanner />
        <View className="flex-1">
          <Slot />
        </View>
      </View>
    </View>
  );
}

/** Everything under /till needs a paired terminal, an operator and an open business day. */
export default function TillLayout() {
  const { session } = useSession();
  if (session.status !== "paired") return <Redirect href="/" />;
  return (
    <DataProvider>
      <SyncProvider>
        <OperatorProvider>
          <TillGate />
        </OperatorProvider>
      </SyncProvider>
    </DataProvider>
  );
}
