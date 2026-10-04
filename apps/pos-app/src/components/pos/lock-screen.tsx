import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { ROLE_LABEL } from "@px-pos/core";
import { Text } from "@/components/ui/text";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";
import { BrandImage } from "./brand-image";
import { SyncPill } from "./sync-pill";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

/** Who's working? Staff pick themselves (PIN login arrives in phase 2). */
export function LockScreen() {
  const { staff } = useData();
  const { signIn } = useOperator();
  const { client, terminal } = usePaired();
  const insets = useSafeAreaInsets();
  const { size } = useBreakpoint();
  const phone = size === "phone";
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="flex-row items-center justify-between px-6 pt-6">
        <BrandImage kind="short" width={170} />
        <View className="items-end">
          <Text className="text-lg font-semibold">{client.name}</Text>
          <Text className="text-sm text-muted-foreground">
            Terminal {terminal.code} · {terminal.name}
          </Text>
        </View>
      </View>
      <Text className="px-6 pt-8 pb-4 text-2xl font-bold">Who&apos;s working?</Text>
      <ScrollView contentContainerClassName="flex-row flex-wrap gap-4 px-6 pb-8">
        {staff.length === 0 ? <Text className="text-muted-foreground">No staff yet. Add staff in PX POS Admin → Staff.</Text> : null}
        {staff.map((s) => (
          <Pressable key={s.id} onPress={() => signIn(s)} accessibilityRole="button" accessibilityLabel={`${s.name}, ${ROLE_LABEL[s.role]}`} style={phone ? { width: "47%" } : undefined} className={phone ? "h-40 items-center justify-center gap-3 rounded-2xl border border-border bg-card active:bg-accent" : "h-40 w-48 items-center justify-center gap-3 rounded-2xl border border-border bg-card active:bg-accent"}>
            <View className="h-16 w-16 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <Text className="text-2xl font-bold text-primary">{initials(s.name)}</Text>
            </View>
            <View className="items-center">
              <Text className="text-lg font-semibold" numberOfLines={1}>
                {s.name}
              </Text>
              <Text className="text-sm text-muted-foreground">{ROLE_LABEL[s.role]}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <View className="flex-row justify-end px-6 pb-4">
        <SyncPill />
      </View>
    </View>
  );
}
