import "../../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import { SessionProvider } from "@/state/session";

export default function RootLayout() {
  // A till must never sleep mid-service.
  useKeepAwake();
  return (
    <SafeAreaProvider>
      <StatusBar style="light" hidden />
      <SessionProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000000" }, animation: "fade" }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
