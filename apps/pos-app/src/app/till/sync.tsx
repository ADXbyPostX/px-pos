import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { istDateTimeLabel } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { HardwarePanel } from "@/components/pos/hardware-panel";
import { journalRows, type JournalRow, type JournalStatus } from "@/local/db";
import { onJournalChange, reconcile, retry } from "@/local/sync";
import { cn } from "@/lib/utils";
import { useSync } from "@/state/sync";

const TABS: { key: JournalStatus; label: string }[] = [
  { key: "rejected", label: "Failed" },
  { key: "pending", label: "Queued" },
  { key: "synced", label: "Synced" },
];

/** The write journal: every sale action this terminal took, and what the server said. */
export default function Sync() {
  const s = useSync();
  const [tab, setTab] = useState<JournalStatus>(s.rejected ? "rejected" : "pending");
  const [rows, setRows] = useState<JournalRow[]>(() => journalRows(tab, 200));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const load = () => setRows(journalRows(tab, 200));
    load();
    return onJournalChange(load);
  }, [tab]);

  async function runReconcile() {
    setBusy(true);
    try {
      const r = await reconcile();
      setNote(`Checked with the server: ${r.confirmed} confirmed, ${r.resubmitted} re-sent`);
    } finally {
      setBusy(false);
    }
  }

  const count = (k: JournalStatus) => (k === "rejected" ? s.rejected : k === "pending" ? s.pending : null);

  return (
    <View className="flex-1">
      <View className="flex-row flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} className={cn("min-h-11 flex-row items-center gap-2 rounded-full border px-4", tab === t.key ? "border-primary bg-primary/15" : "border-border")}>
            <Text className={tab === t.key ? "font-semibold" : ""}>{t.label}</Text>
            {count(t.key) ? <Text className={cn("text-sm tabular-nums", t.key === "rejected" ? "text-primary" : "text-muted-foreground")}>{count(t.key)}</Text> : null}
          </Pressable>
        ))}
        <View className="flex-1" />
        <Text className={cn("text-sm", s.online ? "text-success" : "text-muted-foreground")}>{s.online ? "Online" : "Offline"}</Text>
        <Button size="sm" variant="secondary" disabled={busy || !s.online} onPress={runReconcile}>
          <Text>{busy ? "Checking…" : "Check now"}</Text>
        </Button>
      </View>
      <HardwarePanel />
      {note ? <Text className="px-4 pt-2 text-sm text-muted-foreground">{note}</Text> : null}
      {rows.length === 0 ? (
        <Text className="p-8 text-center text-muted-foreground">{tab === "rejected" ? "Nothing failed" : tab === "pending" ? "Nothing waiting to sync" : "No synced actions in the last 14 days"}</Text>
      ) : (
        <ScrollView contentContainerClassName="gap-2 p-3">
          {rows.map((r) => (
            <View key={r.id} className={cn("gap-1 rounded-xl border bg-card p-3", r.status === "rejected" ? "border-primary/60" : "border-border")}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
                  {r.label}
                </Text>
                <Text className="text-xs text-muted-foreground">{istDateTimeLabel(r.createdAt)}</Text>
              </View>
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {r.primaryPath.split("/").slice(2).join("/")}
                {r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
              </Text>
              {r.error ? <Text className="text-sm text-primary">{r.error}</Text> : null}
              {r.status === "rejected" ? (
                <Button size="sm" variant="outline" className="mt-1 self-start" disabled={!s.online} onPress={() => retry(r)}>
                  <Text>Retry</Text>
                </Button>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
