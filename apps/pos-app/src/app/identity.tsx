import { View } from "react-native";
import { BrandImage } from "@/components/pos/brand-image";
import { Text } from "@/components/ui/text";
import { useSession } from "@/state/session";

/**
 * The tablet's saved identity no longer matches Firebase (app data cleared or reinstalled).
 * We never mint a new identity over unsynced sales: an admin must pair it again.
 */
export default function IdentityLost() {
  const { session } = useSession();
  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background px-10">
      <BrandImage kind="short" width={220} />
      <Text className="text-3xl font-bold">Terminal identity lost</Text>
      <Text className="max-w-2xl text-center text-lg text-muted-foreground">
        This tablet&apos;s sign-in changed, so it can&apos;t continue as the paired terminal. Ask an admin to revoke the old terminal and pair this tablet again from PX POS Admin → Terminals.
      </Text>
      {session.status === "identity_lost" ? <Text className="font-mono text-xs text-muted-foreground">expected {session.expected.slice(0, 8)} · now {session.actual?.slice(0, 8) ?? "none"}</Text> : null}
    </View>
  );
}
