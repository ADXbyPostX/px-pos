import { ActivityIndicator, Linking, Platform, View } from "react-native";
import { Redirect } from "expo-router";
import { BrandImage } from "@/components/pos/brand-image";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useSession, type BootError } from "@/state/session";
import { colors } from "@/lib/colors";

/** What a first start that failed needs from the person at the counter. */
function BootProblem({ error, onRetry }: { error: BootError; onRetry: () => void }) {
  const copy =
    error.reason === "clock"
      ? {
          title: "Set the date and time",
          body: `This terminal's clock says ${new Date().toDateString()}. Turn on automatic date and time, then connect it to the internet.`,
          settings: { label: "Open date & time", action: "android.settings.DATE_SETTINGS" },
        }
      : error.reason === "offline"
        ? {
            title: "Connect to the internet",
            body: "This terminal needs the internet once to set up. Connect it to Wi-Fi or Ethernet and it will carry on by itself.",
            settings: { label: "Open Wi-Fi settings", action: "android.settings.WIFI_SETTINGS" },
          }
        : { title: "Couldn't start", body: error.message, settings: null };
  return (
    <View className="max-w-md items-center gap-3 px-8">
      <Text className="text-center text-xl font-semibold">{copy.title}</Text>
      <Text className="text-center text-muted-foreground">{copy.body}</Text>
      <View className="mt-3 flex-row flex-wrap justify-center gap-3">
        {copy.settings && Platform.OS === "android" ? (
          <Button variant="outline" onPress={() => void Linking.sendIntent(copy.settings.action).catch(() => {})}>
            <Text>{copy.settings.label}</Text>
          </Button>
        ) : null}
        <Button onPress={onRetry}>
          <Text>Try again</Text>
        </Button>
      </View>
    </View>
  );
}

/** Boot gate: identity → pairing → the till. */
export default function Gate() {
  const { session, retry } = useSession();
  if (session.status === "identity_lost") return <Redirect href="/identity" />;
  if (session.status === "unpaired") return <Redirect href="/pair" />;
  if (session.status === "revoked") return <Redirect href="/revoked" />;
  if (session.status === "paired") return <Redirect href="/till" />;
  return (
    <View className="flex-1 items-center justify-center gap-10 bg-background">
      <BrandImage kind="short" width={260} />
      {session.status === "error" ? <BootProblem error={session} onRetry={retry} /> : <ActivityIndicator color={colors.red} size="large" />}
    </View>
  );
}
