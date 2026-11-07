import { useState } from "react";
import { ScrollView, View } from "react-native";
import { collection, documentId, query, where } from "@react-native-firebase/firestore";
import { addMonths, monthLabel, monthOf, monthRange, monthReport, paths, receiptText, renderMonth, type DailyStats, type Day, type MonthDoc, type MonthKey } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useLiveDoc, useLiveQuery, useNow } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { printMonth } from "@/print/print";
import { useData } from "@/state/data";
import { usePaired } from "@/state/session";

/**
 * Day › Month report (owner / manager): this month so far or an earlier one, previewed as it
 * prints. A closed month prints its frozen report (closed in admin › End of day › Months).
 */
export function MonthReportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = usePaired();
  const { suggestedBizDate } = useData();
  const now = useNow(60_000);
  const thisMonth = monthOf(suggestedBizDate);
  const choices: MonthKey[] = [thisMonth, addMonths(thisMonth, -1), addMonths(thisMonth, -2)];
  const [month, setMonth] = useState<MonthKey>(thisMonth);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { from, to } = monthRange(month);
  const cid = session.cid;
  const key = open ? `${cid}:${month}` : null;
  const stats = useLiveQuery<DailyStats>(key ? `mstats:${key}` : null, (db) => query(collection(db, paths.col(cid, "dailyStats")), where(documentId(), ">=", from), where(documentId(), "<=", to)));
  const days = useLiveQuery<Day>(key ? `mdays:${key}` : null, (db) => query(collection(db, paths.col(cid, "days")), where(documentId(), ">=", from), where(documentId(), "<=", to)));
  const doc = useLiveDoc<MonthDoc>(key ? paths.month(cid, month) : null);
  const closed = doc.data?.status === "closed" ? doc.data : null;
  const report = closed ? closed.report : monthReport({ month, days: days.data, stats: stats.data, builtAtMs: now });
  const loading = stats.status === "loading" || days.status === "loading" || doc.status === "loading";
  const text = receiptText(renderMonth(report, { cols: 32, outletName: session.client.name, live: !closed, ...(closed ? { closedAtMs: closed.closedAtMs } : {}) }), 32);

  async function print() {
    setPrinting(true);
    setMessage(null);
    const err = await printMonth(session.terminal, session.client.name, report, { live: !closed, ...(closed ? { closedAtMs: closed.closedAtMs } : {}) });
    setPrinting(false);
    setMessage(err ?? "Printed");
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Month report"
      wide
      footer={
        <>
          <Button variant="outline" onPress={onClose} accessibilityLabel="Close month report">
            <Text>Close</Text>
          </Button>
          <Button onPress={() => void print()} disabled={loading || printing} accessibilityLabel={`Print the ${monthLabel(month)} report`}>
            <Text>{printing ? "Printing…" : "Print"}</Text>
          </Button>
        </>
      }
    >
      <View className="gap-3">
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {choices.map((m) => (
            <Button
              key={m}
              variant={m === month ? "default" : "outline"}
              size="sm"
              onPress={() => {
                setMonth(m);
                setMessage(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: m === month }}
              accessibilityLabel={monthLabel(m)}
            >
              <Text>{m === thisMonth ? "This month" : monthLabel(m, true)}</Text>
            </Button>
          ))}
        </View>
        <Text className={cn("text-sm", closed ? "text-success" : "text-muted-foreground")}>
          {loading ? "Loading…" : closed ? `${monthLabel(month)} is closed` : stats.fromCache ? "Not closed · offline, some days may be missing" : "Not closed · figures so far"}
        </Text>
        <ScrollView className="max-h-96 rounded-xl border border-border bg-white px-3 py-2">
          <Text style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 16, color: "#000" }}>{text}</Text>
        </ScrollView>
        {message ? (
          <Text className={cn("text-sm", message === "Printed" ? "text-success" : "text-warning")} accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}
