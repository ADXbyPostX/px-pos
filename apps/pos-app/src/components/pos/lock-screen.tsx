import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { ROLE_LABEL, type Staff } from "@px-pos/core";
import { Text } from "@/components/ui/text";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useNow, type WithId } from "@/hooks/use-live";
import { colors } from "@/lib/colors";
import { pinLength, pinMatches } from "@/lib/pin";
import { cn } from "@/lib/utils";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";
import { BrandImage } from "./brand-image";
import { Keypad } from "./keypad";
import { SyncPill } from "./sync-pill";

type Person = WithId<Staff>;

const MAX_TRIES = 5;
const LOCK_MS = 30_000;
/** Wrong tries per person on this terminal; five in a row locks that name for 30 s. */
const strikes = new Map<string, { n: number; until: number }>();

function recordWrongPin(id: string) {
  const n = (strikes.get(id)?.n ?? 0) + 1;
  strikes.set(id, n >= MAX_TRIES ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
const roleLabel = (s: Staff) => (s.adminUid ? "Admin" : ROLE_LABEL[s.role]);

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <View className={cn("items-center justify-center rounded-full border border-primary/40 bg-primary/10", large ? "h-20 w-20" : "h-16 w-16")}>
      <Text className={cn("font-bold text-primary", large ? "text-3xl" : "text-2xl")}>{initials(name)}</Text>
    </View>
  );
}

/** One person's PIN: signs in as soon as the last digit is typed (the length is known from the hash). */
function PinEntry({ person, onBack, onOk }: { person: Person; onBack: () => void; onOk: () => void }) {
  const len = pinLength(person.pinHash);
  const [digits, setDigits] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);
  const strike = strikes.get(person.id);
  const lockedFor = strike && strike.until > now ? Math.ceil((strike.until - now) / 1000) : 0;
  const first = person.name.split(" ")[0];

  async function check(pin: string) {
    setChecking(true);
    let ok: boolean;
    try {
      ok = await pinMatches(pin, person.pinHash);
    } catch {
      setChecking(false);
      setDigits("");
      return setError("This till can't check PINs. Update PX POS on it.");
    }
    setChecking(false);
    if (ok) {
      strikes.delete(person.id);
      return onOk();
    }
    recordWrongPin(person.id);
    setWrong(true);
    setDigits("");
  }

  function onKey(k: string) {
    if (checking || lockedFor || !len) return;
    setWrong(false);
    setError(null);
    if (k === "⌫") return setDigits((d) => d.slice(0, -1));
    const next = (digits + k).slice(0, len);
    setDigits(next);
    if (next.length === len) void check(next);
  }

  const status = lockedFor ? `Too many wrong tries. Try again in ${lockedFor} s` : (error ?? (checking ? "Checking…" : wrong ? "Wrong PIN. Try again" : "Enter your PIN"));
  return (
    <View className="flex-1 items-center px-6 pb-4">
      <View className="w-full max-w-sm flex-1">
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Not you? Back to names" className="h-12 flex-row items-center gap-1 self-start pr-3 active:opacity-60">
          <ChevronLeft color={colors.muted} size={22} />
          <Text className="text-muted-foreground">Not {first}?</Text>
        </Pressable>
        <View className="items-center gap-1 py-3">
          <Avatar name={person.name} large />
          <Text className="pt-2 text-2xl font-bold" numberOfLines={1}>
            {person.name}
          </Text>
          <Text className="text-muted-foreground">{roleLabel(person)}</Text>
        </View>
        {len ? (
          <>
            <View className="flex-row justify-center gap-4 py-3" accessible accessibilityLabel={`${digits.length} of ${len} digits entered`}>
              {Array.from({ length: len }, (_, i) => (
                <View key={i} className={cn("h-4 w-4 rounded-full border-2", i < digits.length ? "border-primary bg-primary" : "border-muted-foreground")} />
              ))}
            </View>
            <Text accessibilityLiveRegion="polite" className={cn("text-center", wrong || lockedFor || error ? "text-primary" : "text-muted-foreground")}>
              {status}
            </Text>
            <View className={cn("flex-1 pt-4", (checking || lockedFor) && "opacity-40")}>
              <Keypad pin fill onKey={onKey} />
            </View>
          </>
        ) : (
          <Text className="pt-8 text-center text-lg text-muted-foreground">
            {first} has no PIN yet. Ask your admin to set one in PX POS Admin → Staff.
          </Text>
        )}
      </View>
    </View>
  );
}

/** Who's working? Pick your name, then type your PIN (checked on this terminal, so it works offline). */
export function LockScreen() {
  const { staff } = useData();
  const { signIn } = useOperator();
  const { client, terminal } = usePaired();
  const insets = useSafeAreaInsets();
  const { size } = useBreakpoint();
  const phone = size === "phone";
  const [pickedId, setPickedId] = useState<string | null>(null);
  // `staff` holds active people only: someone switched off while picked drops back to the names.
  const picked = staff.find((s) => s.id === pickedId) ?? null;
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
      {picked ? (
        <PinEntry key={picked.id} person={picked} onBack={() => setPickedId(null)} onOk={() => signIn(picked)} />
      ) : (
        <>
          <Text className="px-6 pt-8 pb-4 text-2xl font-bold">Who&apos;s working?</Text>
          <ScrollView contentContainerClassName="flex-row flex-wrap gap-4 px-6 pb-8">
            {staff.length === 0 ? <Text className="text-muted-foreground">No staff yet. Add staff in PX POS Admin → Staff.</Text> : null}
            {staff.map((s) => (
              <Pressable key={s.id} onPress={() => setPickedId(s.id)} accessibilityRole="button" accessibilityLabel={`${s.name}, ${roleLabel(s)}`} style={phone ? { width: "47%" } : undefined} className={phone ? "h-40 items-center justify-center gap-3 rounded-2xl border border-border bg-card active:bg-accent" : "h-40 w-48 items-center justify-center gap-3 rounded-2xl border border-border bg-card active:bg-accent"}>
                <Avatar name={s.name} />
                <View className="items-center">
                  <Text className="text-lg font-semibold" numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text className="text-sm text-muted-foreground">{roleLabel(s)}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      <View className="flex-row justify-end px-6 pb-4">
        <SyncPill />
      </View>
    </View>
  );
}
