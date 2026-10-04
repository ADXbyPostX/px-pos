import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { useSync } from "@/state/sync";
import { cn } from "@/lib/utils";

/** Synced (green) · Offline N queued (zinc) · Syncing N (yellow) · N failed (red → Sync screen). */
export function SyncPill({ compact = false }: { compact?: boolean }) {
  const s = useSync();
  const state = s.rejected > 0 ? "failed" : !s.online ? "offline" : s.pending > 0 ? "syncing" : "synced";
  const label = state === "failed" ? `${s.rejected} failed` : state === "offline" ? `Offline${s.pending ? ` · ${s.pending} queued` : ""}` : state === "syncing" ? `Syncing ${s.pending}` : "Synced";
  const dot = state === "failed" ? "bg-primary" : state === "offline" ? "bg-muted-foreground" : state === "syncing" ? "bg-warning" : "bg-success";
  return (
    <Pressable onPress={() => router.push("/till/sync")} accessibilityRole="button" accessibilityLabel={`Sync status: ${label}`} className={cn("min-h-11 flex-row items-center gap-2 rounded-full border border-border px-3", state === "failed" && "border-primary/60")}>
      <View className={cn("h-2.5 w-2.5 rounded-full", dot)} />
      {!compact ? <Text className="text-sm">{label}</Text> : null}
    </Pressable>
  );
}
