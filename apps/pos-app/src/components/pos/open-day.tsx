import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { addDays, bizDateLabel, can, dayOpenPlan, formatINR, parseINR, paths, type Day } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { planCtx } from "@/actions/context";
import { useLiveDoc } from "@/hooks/use-live";
import { allocateAndJournal } from "@/local/db";
import { submit } from "@/local/sync";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";
import { applyKey, Keypad } from "./keypad";

/**
 * Start of the business day on this terminal: count the opening float into the drawer. When the
 * calendar's business day is already closed (End of day ran this evening), the next one opens.
 */
export function OpenDay() {
  const session = usePaired();
  const { suggestedBizDate, setBizDate } = useData();
  const base = useLiveDoc<Day>(paths.day(session.cid, suggestedBizDate));
  const target = base.data?.status === "closed" ? addDays(suggestedBizDate, 1) : suggestedBizDate;
  const { operator, lock } = useOperator();
  const day = useLiveDoc<Day>(paths.day(session.cid, target));
  const [amount, setAmount] = useState("2000");
  const float = parseINR(amount) ?? 0;
  const closed = day.data?.status === "closed";
  const allowed = operator ? can(operator.role, "dayOpen") : false;
  const { size } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const phone = size === "phone";

  function open() {
    if (!operator) return;
    const { row } = allocateAndJournal(`dayopen:${target}:${session.tid}`, [], () => ({
      plan: dayOpenPlan(planCtx(session, operator), { businessDate: target, floatPaise: float, createDay: !day.data }),
      result: null,
    }));
    submit(row);
    setBizDate(target);
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName={phone ? "" : "flex-1 flex-row"} style={{ paddingTop: insets.top }} contentContainerStyle={{ paddingBottom: insets.bottom }}>
      <View className={phone ? "gap-3 px-6 pt-8" : "flex-1 justify-center gap-4 px-12"}>
        <Text className="text-sm text-muted-foreground">{session.client.name}</Text>
        <Text className={phone ? "text-3xl font-bold" : "text-4xl font-bold"}>Open the day</Text>
        <Text className="text-xl text-muted-foreground">Business day {bizDateLabel(target, true)}</Text>
        {base.data?.status === "closed" ? (
          <Text className="text-lg text-success">
            {bizDateLabel(suggestedBizDate)} is closed{base.data.zNo ? ` (Z ${base.data.zNo})` : ""}.
          </Text>
        ) : null}
        {closed ? <Text className="text-lg text-primary">This business day was already closed. Ask a manager to reopen it in PX POS Admin.</Text> : null}
        {!allowed ? <Text className="text-lg text-warning">A cashier or manager has to open the day.</Text> : null}
        <View className={phone ? "mt-2 flex-row gap-3" : "mt-6 flex-row gap-3"}>
          <Button variant="ghost" onPress={lock}>
            <Text>Switch user</Text>
          </Button>
        </View>
      </View>
      <View className={phone ? "mt-6 gap-4 border-t border-border bg-card p-6" : "w-[440px] justify-center gap-4 border-l border-border bg-card p-8"}>
        <Text className="text-base text-muted-foreground">Opening cash in the drawer</Text>
        <Text className="text-5xl font-bold tabular-nums">₹{amount || "0"}</Text>
        <Keypad onKey={(k) => setAmount((a) => applyKey(a, k))} />
        <Button size="xl" onPress={open} disabled={!allowed || closed}>
          <Text>Open day with {formatINR(float, { decimals: "auto" })}</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
