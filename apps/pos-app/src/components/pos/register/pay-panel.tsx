import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { Ban, Banknote, CreditCard, Keyboard, PauseCircle, QrCode as QrIcon, SplitSquareHorizontal, Wallet, X } from "lucide-react-native";
import { formatINR, parseINR, quickCash, settleTenders, tenderStatus, upiPayUri, type Paise, type PayMode, type TenderInput, type UpiAccount } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { customerDisplay } from "@/hardware/customer-display";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { applyKey, Keypad } from "../keypad";
import { QrCode } from "../qr-code";

const MODES: { mode: PayMode; label: string; hint: string; Icon: typeof Banknote }[] = [
  { mode: "cash", label: "Cash", hint: "Cash received", Icon: Banknote },
  { mode: "upi", label: "UPI", hint: "UPI amount", Icon: QrIcon },
  { mode: "card", label: "Card", hint: "Charge this on the card machine", Icon: CreditCard },
  { mode: "other", label: "Other", hint: "Swiggy, Zomato, coupon or credit", Icon: Wallet },
];
const modeOf = (m: PayMode) => MODES.find((x) => x.mode === m)!;

const rs = (p: Paise) => formatINR(p, { decimals: "auto" });
const text = (p: Paise) => formatINR(p, { symbol: false, decimals: "auto" }).replace(/,/g, "");

/**
 * Take payment. Pick how the customer pays; the amount starts at what's due (the first key
 * replaces it), and Complete settles with whatever is on screen — no separate "add" step.
 * Split pays part now in one mode and the rest in another. UPI shows a QR with the amount
 * (here and on the customer display) when the outlet's UPI ID is set in admin.
 * Everything fits one screen: the keypad stretches to fill the height that's left.
 */
export function PayPanel({
  grandPaise,
  onCancel,
  onSettle,
  onHold,
  onVoid,
  upi,
  busy = false,
  compact = false,
}: {
  grandPaise: Paise;
  onCancel: () => void;
  onSettle: (tenders: TenderInput[], tipPaise: Paise) => void;
  /** Park the order instead (only offered before any payment is entered). */
  onHold?: () => void;
  /** Throw the order away (only offered before anything was sent or paid). */
  onVoid?: () => void;
  /** The outlet's UPI account; without it UPI is recorded like card. */
  upi?: UpiAccount | undefined;
  busy?: boolean;
  compact?: boolean;
}) {
  const tip = 0;
  const [tenders, setTenders] = useState<TenderInput[]>([]);
  const [mode, setMode] = useState<PayMode>("cash");
  const [amount, setAmount] = useState(() => text(grandPaise));
  /** The amount on screen is a suggestion: the next key starts a fresh number. */
  const [fresh, setFresh] = useState(true);
  /** UPI: type a part amount instead of showing the QR. */
  const [typing, setTyping] = useState(false);
  const [qrBox, setQrBox] = useState(0);

  const due = tenderStatus(grandPaise, tip, tenders).remainingPaise;
  const typed = parseINR(amount) ?? 0;
  const pending: TenderInput | null = typed > 0 && due > 0 ? { mode, amountPaise: typed } : null;
  const all = pending ? [...tenders, pending] : tenders;
  const result = settleTenders(grandPaise, tip, all);
  const status = tenderStatus(grandPaise, tip, all);
  const quick = useMemo(() => quickCash(due).slice(0, 4), [due]);
  const qrUri = mode === "upi" && upi && !typing && typed > 0 ? upiPayUri(upi, typed) : null;
  const canSplit = pending != null && typed < due;
  const m = modeOf(mode);

  // The customer sees what to pay — as a QR when it's UPI.
  const upiVpa = upi?.vpa;
  const upiPayee = upi?.payee;
  useEffect(() => {
    if (due <= 0) return;
    if (mode === "upi" && upiVpa && upiPayee && typed > 0) customerDisplay.upi({ vpa: upiVpa, payee: upiPayee }, typed);
    else customerDisplay.pay(mode === "cash" || typed <= 0 ? due : typed, mode === "cash" ? undefined : modeOf(mode).label);
  }, [mode, typed, due, upiVpa, upiPayee]);

  function pick(next: PayMode) {
    setMode(next);
    setAmount(text(due));
    setFresh(true);
    setTyping(false);
  }
  function press(k: string) {
    setAmount((a) => applyKey(fresh ? "" : a, k));
    setFresh(false);
  }
  function split() {
    if (!pending) return;
    const next = [...tenders, pending];
    setTenders(next);
    const left = tenderStatus(grandPaise, tip, next).remainingPaise;
    setAmount(left ? text(left) : "");
    setFresh(true);
    setTyping(false);
    if (mode === "cash" && left) setMode("upi");
  }
  function removeTender(idx: number) {
    const next = tenders.filter((_, j) => j !== idx);
    setTenders(next);
    setAmount(text(tenderStatus(grandPaise, tip, next).remainingPaise));
    setFresh(true);
  }

  const tenderLabel = (t: TenderInput) => `${modeOf(t.mode).label} ${rs(t.amountPaise)}`;

  // ── pieces ────────────────────────────────────────────────────────────────
  const header = (
    <View className="flex-row items-center gap-2">
      <View className="flex-1">
        <Text className="text-xs text-muted-foreground">{tenders.length ? `Left to pay of ${rs(grandPaise)}` : "Bill total"}</Text>
        <Text className="text-3xl font-bold tabular-nums">{rs(due)}</Text>
      </View>
      {onHold && tenders.length === 0 ? (
        <Button variant="ghost" size="sm" onPress={onHold} accessibilityLabel="Hold this order">
          <PauseCircle color={colors.foreground} size={20} />
          <Text>Hold</Text>
        </Button>
      ) : null}
      {onVoid ? (
        <Button variant="ghost" size="sm" onPress={onVoid} accessibilityLabel="Void this order">
          <Ban color={colors.red} size={20} />
          <Text className="text-primary">Void</Text>
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onPress={onCancel} accessibilityLabel="Back to menu">
        <X color={colors.foreground} size={20} />
        <Text>Back</Text>
      </Button>
    </View>
  );

  const modes = (
    <View className="flex-row gap-2" accessibilityRole="radiogroup">
      {MODES.map(({ mode: x, label, Icon }) => (
        <Pressable
          key={x}
          onPress={() => pick(x)}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === x }}
          accessibilityLabel={`Pay by ${label}`}
          className={cn("h-14 flex-1 items-center justify-center gap-0.5 rounded-xl border", mode === x ? "border-primary bg-primary/15" : "border-border bg-card active:bg-accent")}
        >
          <Icon color={mode === x ? colors.red : colors.foreground} size={20} />
          <Text className={cn("text-sm", mode === x ? "font-semibold" : "")}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const change = mode === "cash" && result.ok ? result.changePaise : 0;
  const amountCard = (
    <View className="flex-row items-end gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
      <View className="flex-1">
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {m.hint}
        </Text>
        <Text className={cn("text-4xl font-bold tabular-nums", fresh && "text-foreground/80")} numberOfLines={1} adjustsFontSizeToFit>
          ₹{amount || "0"}
        </Text>
      </View>
      {change > 0 ? (
        <View className="items-end">
          <Text className="text-xs text-muted-foreground">Change</Text>
          <Text className="text-3xl font-bold tabular-nums text-success">{rs(change)}</Text>
        </View>
      ) : canSplit ? (
        <View className="items-end">
          <Text className="text-xs text-muted-foreground">Still due</Text>
          <Text className="text-2xl font-bold tabular-nums text-warning">{rs(status.remainingPaise)}</Text>
        </View>
      ) : null}
    </View>
  );

  const quickRow =
    mode === "cash" && quick.length ? (
      <View className="flex-row gap-2">
        {quick.map((v, i) => (
          <Button
            key={v}
            variant="secondary"
            className="flex-1 px-1"
            onPress={() => {
              setAmount(text(v));
              setFresh(true);
            }}
            accessibilityLabel={i === 0 ? `Exact ${rs(v)}` : `Customer gave ${rs(v)}`}
          >
            <Text numberOfLines={1}>{i === 0 ? "Exact" : rs(v)}</Text>
          </Button>
        ))}
      </View>
    ) : null;

  const qrPanel = qrUri ? (
    <View
      className="flex-1 items-center justify-center gap-2"
      onLayout={(e: LayoutChangeEvent) => setQrBox(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height - 64))}
    >
      {qrBox > 80 ? <QrCode value={qrUri} size={Math.min(qrBox, 320)} accessibilityLabel={`UPI QR for ${rs(typed)}`} /> : null}
      <Text className="text-center text-sm text-muted-foreground">
        Scan with any UPI app · {rs(typed)} to {upi?.vpa}
      </Text>
      <Button variant="ghost" size="sm" onPress={() => setTyping(true)} accessibilityLabel="Enter a different UPI amount">
        <Keyboard color={colors.foreground} size={18} />
        <Text>Different amount</Text>
      </Button>
    </View>
  ) : null;

  const body = (
    <View className="flex-1 gap-2">
      {qrPanel ?? <Keypad fill onKey={press} />}
      {mode === "upi" && !upi ? <Text className="text-center text-xs text-muted-foreground">Add the outlet&apos;s UPI ID in admin › Settings › Payments to show a QR here.</Text> : null}
      {mode === "upi" && upi && typing ? (
        <Button variant="ghost" size="sm" className="self-center" onPress={() => setTyping(false)} accessibilityLabel="Show the UPI QR">
          <QrIcon color={colors.foreground} size={18} />
          <Text>Show QR</Text>
        </Button>
      ) : null}
    </View>
  );

  const chips = tenders.length ? (
    <View className="flex-row flex-wrap gap-2">
      {tenders.map((t, idx) => (
        <Pressable key={idx} onPress={() => removeTender(idx)} accessibilityRole="button" accessibilityLabel={`Remove ${tenderLabel(t)}`} className="h-10 flex-row items-center gap-1.5 rounded-full border border-border pr-2 pl-3 active:bg-accent">
          <Text className="tabular-nums">Paid {tenderLabel(t)}</Text>
          <X color={colors.muted} size={16} />
        </Pressable>
      ))}
    </View>
  ) : null;

  const warn = status.overpaidNonCash ? <Text className="text-sm text-primary">{m.label} can&apos;t be more than {rs(due)}. Give the rest as cash.</Text> : null;

  const actions = (
    <View className="flex-row gap-2">
      {canSplit ? (
        <Button size="xl" variant="outline" className="px-4" onPress={split} accessibilityLabel={`Take ${tenderLabel(pending!)} now and the rest another way`}>
          <SplitSquareHorizontal color={colors.foreground} size={20} />
          <Text>Split</Text>
        </Button>
      ) : null}
      <Button size="xl" variant="success" className="flex-1" disabled={!result.ok || busy} onPress={() => onSettle(all, tip)} accessibilityLabel="Complete the sale">
        <Text numberOfLines={1}>{change > 0 ? `Complete · give ${rs(change)}` : "Complete sale"}</Text>
      </Button>
    </View>
  );

  // Phones / portrait: one column, nothing scrolls; the keypad (or QR) takes the free height.
  if (compact) {
    return (
      <View className="flex-1 gap-2.5 p-3">
        {header}
        {modes}
        {amountCard}
        {quickRow}
        {body}
        {chips}
        {warn}
        {actions}
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row">
      <View className="flex-1 gap-3 p-5">
        {header}
        {modes}
        {amountCard}
        {quickRow}
        {body}
      </View>
      <View className="w-[320px] gap-3 border-l border-border p-5">
        <Text className="text-sm text-muted-foreground">Bill total</Text>
        <Text className="text-3xl font-bold tabular-nums">{rs(grandPaise)}</Text>
        <ScrollView className="flex-1" contentContainerClassName="gap-2">
          {chips}
        </ScrollView>
        {warn}
        {actions}
      </View>
    </View>
  );
}
