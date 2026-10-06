import { useState } from "react";
import { ScrollView, View } from "react-native";
import { collection, query, where } from "@react-native-firebase/firestore";
import { bizDateLabel, can, cashStats, expectedCashFor, formatINR, parseINR, paths, type Drawer, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { closeDayOnTill } from "@/actions/day";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useLiveQuery } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { printZ } from "@/print/print";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";
import { useSync } from "@/state/sync";
import { applyKey, Keypad } from "./keypad";

const rs = (p: number) => formatINR(p, { decimals: "auto" });

function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("unavailable")) return "No connection to the server. Check the internet and try again.";
  if (code.includes("permission-denied")) return "The server refused the close. Close the day from PX POS Admin instead.";
  if (code.includes("aborted") || code.includes("failed-precondition")) return "Something changed while closing. Try again.";
  return e instanceof Error ? e.message : "Couldn't close the day.";
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View className="min-h-9 flex-row items-center gap-3">
      <View className={cn("h-6 w-6 items-center justify-center rounded-full", ok ? "bg-success/20" : "bg-primary/20")}>
        <Text className={cn("text-sm font-bold", ok ? "text-success" : "text-primary")}>{ok ? "✓" : "!"}</Text>
      </View>
      <Text className={cn("flex-1 text-base", !ok && "font-semibold")}>{label}</Text>
    </View>
  );
}

/**
 * End of day on the till: checks (online, synced, no running orders, other drawers closed, an
 * owner/manager signed in), the cash count against what the drawer should hold, then one
 * transaction that closes the drawer and the day and prints the Z report. Once the day doc reads
 * closed, the till gate shows Open day for the next business day.
 */
export function EndOfDay({ onCancel }: { onCancel: () => void }) {
  const session = usePaired();
  const { bizDate, drawer, stats, openOrders } = useData();
  const { operator } = useOperator();
  const { online, pending } = useSync();
  const { size } = useBreakpoint();
  const phone = size === "phone";
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const drawers = useLiveQuery<Drawer>(bizDate ? `drawers:${session.cid}:${bizDate}` : null, (db) => query(collection(db, paths.col(session.cid, "drawers")), where("businessDate", "==", bizDate)));
  const terminals = useLiveQuery<Terminal>(`terminals:${session.cid}`, (db) => collection(db, paths.col(session.cid, "terminals")));
  const otherOpen = drawers.data.filter((d) => d.terminalId !== session.tid && d.status === "open");
  const otherNames = otherOpen.map((d) => terminals.data.find((t) => t.id === d.terminalId)?.name ?? "another counter");

  const expected = expectedCashFor(drawer?.openingFloatPaise ?? 0, cashStats(stats?.cash?.[session.tid]));
  const counted = amount === "" ? null : parseINR(amount);
  const diff = counted == null ? null : counted - expected;
  const allowed = operator ? can(operator.role, "dayClose") : false;
  const running = openOrders.length;

  const checks = [
    { ok: online, label: online ? "Connected to the internet" : "No internet: closing the day needs a connection" },
    { ok: pending === 0, label: pending === 0 ? "All sales synced" : `${pending} sale${pending === 1 ? "" : "s"} still syncing. Wait a moment.` },
    { ok: running === 0, label: running === 0 ? "No running orders" : `${running} running order${running === 1 ? "" : "s"}: settle or cancel ${running === 1 ? "it" : "them"} first` },
    {
      ok: otherOpen.length === 0,
      label: otherOpen.length === 0 ? "Every counter's drawer is closed" : `${otherNames.join(", ")} ${otherOpen.length === 1 ? "is" : "are"} still open. Close ${otherOpen.length === 1 ? "it" : "them"} there, or close the day from PX POS Admin.`,
    },
    { ok: allowed, label: allowed ? `${operator?.name ?? "You"} can close the day` : "Only an owner or manager can close the day" },
  ];
  const ready = checks.every((c) => c.ok) && counted != null && Boolean(bizDate && operator);

  async function close() {
    if (!ready || !bizDate || !operator || counted == null) return;
    setBusy(true);
    setError(null);
    try {
      const { z } = await closeDayOnTill(session, operator, bizDate, counted);
      // The day doc now reads closed and the till moves on to Open day; the Z prints meanwhile.
      void printZ(session.terminal, session.client.name, z, Object.fromEntries(terminals.data.map((t) => [t.id, t.name])));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName={cn("gap-4 p-4", !phone && "flex-row items-start")}>
      <View className="flex-1 gap-4">
        <View className="gap-1">
          <Text className="text-3xl font-bold">End of day</Text>
          <Text className="text-lg text-muted-foreground">Business day {bizDate ? bizDateLabel(bizDate, true) : ""}</Text>
        </View>
        <View className="gap-1 rounded-2xl border border-border bg-card px-4 py-3">
          {checks.map((c) => (
            <Check key={c.label} ok={c.ok} label={c.label} />
          ))}
        </View>
        <View className="gap-2 rounded-2xl border border-border bg-card px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-base text-muted-foreground">Cash the drawer should hold</Text>
            <Text className="text-xl font-bold tabular-nums">{rs(expected)}</Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-base text-muted-foreground">Counted</Text>
            <Text className="text-xl font-bold tabular-nums">{counted == null ? "–" : rs(counted)}</Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-base text-muted-foreground">Difference</Text>
            <Text className={cn("text-xl font-bold tabular-nums", diff == null ? "text-muted-foreground" : diff === 0 ? "text-success" : diff < 0 ? "text-primary" : "text-warning")}>
              {diff == null ? "–" : diff === 0 ? "Matches" : `${diff < 0 ? "Short" : "Over"} ${rs(Math.abs(diff))}`}
            </Text>
          </View>
        </View>
        {error ? <Text className="text-base text-primary">{error}</Text> : null}
        <Button variant="ghost" onPress={onCancel} disabled={busy} accessibilityLabel="Back to the day report">
          <Text>Back</Text>
        </Button>
      </View>
      <View className={cn("gap-4 rounded-2xl border border-border bg-card p-4", !phone && "w-[400px]")}>
        <Text className="text-base text-muted-foreground">Count the cash in the drawer</Text>
        <Text className="text-5xl font-bold tabular-nums">₹{amount || "0"}</Text>
        <Keypad onKey={(k) => setAmount((a) => applyKey(a, k))} />
        <Button size="xl" onPress={() => void close()} disabled={!ready || busy} accessibilityLabel="Close the day and print the Z report">
          <Text>{busy ? "Closing…" : "Close day and print Z"}</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
