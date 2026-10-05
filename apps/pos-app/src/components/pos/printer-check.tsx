import { useEffect, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { setBtPrinter, useBtPrinter, type BtPrinterPref } from "@/local/prefs";
import { cn } from "@/lib/utils";
import { testPage } from "@/print/encode";
import { route } from "@/print/print";
import { usePaired } from "@/state/session";
import { bluetoothState, listBluetoothDevices, usbPrinterStatus, type BluetoothDeviceInfo, type UsbPrinterStatus } from "../../../modules/pos-hardware";

const hex = (n: number | null) => (n == null ? "–" : `0x${n.toString(16).padStart(2, "0")}`);
function describe(st: UsbPrinterStatus): string {
  if (!st.answered) return "The printer didn't report its status.";
  const state = st.coverOpen ? "cover open" : st.paperOut ? "out of paper" : st.error ? "printer error" : "ready";
  return `Printer says: ${state} (status ${hex(st.printer)} ${hex(st.offline)} ${hex(st.roll)})`;
}

// Android BluetoothClass.Device.Major: computers, phones, audio, wearables, toys and health
// devices are never printers. Imaging (printers) and unknown/misc ones are listed.
const NOT_PRINTERS = new Set([0x0100, 0x0200, 0x0400, 0x0700, 0x0800, 0x0900]);
const IMAGING = 0x0600;

/** Android 12+ asks for "Nearby devices" before an app may talk to paired Bluetooth devices. */
async function canUseBluetooth(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 31) return true;
  const p = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(p)) return true;
  return (await PermissionsAndroid.request(p)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** Paired devices that could be a receipt printer, printers first. */
function scan(allowed: boolean) {
  const rank = (d: BluetoothDeviceInfo) => (d.majorClass === IMAGING || d.spp ? 0 : 1);
  const devices = (allowed ? listBluetoothDevices() : []).filter((d) => !NOT_PRINTERS.has(d.majorClass)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { state: bluetoothState(), devices, allowed };
}

function usePairedPrinters() {
  const [snap, setSnap] = useState(() => scan(Platform.OS === "android" && Number(Platform.Version) < 31));
  useEffect(() => {
    let live = true;
    const look = () =>
      canUseBluetooth()
        .catch(() => false)
        .then((ok) => live && setSnap(scan(ok)));
    void look();
    // Back from Android's Bluetooth settings (pairing a printer): look again.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void look());
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return snap;
}

function WidthChoice({ value, onChange }: { value: 58 | 80; onChange: (w: 58 | 80) => void }) {
  return (
    <View className="flex-row gap-1">
      {([58, 80] as const).map((w) => (
        <Pressable key={w} onPress={() => onChange(w)} accessibilityRole="radio" accessibilityLabel={`${w} mm paper`} accessibilityState={{ selected: value === w }} className={cn("min-h-10 justify-center rounded-md border px-3", value === w ? "border-primary bg-primary/15" : "border-border")}>
          <Text className={cn("text-sm", value === w && "font-semibold")}>{w} mm</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Which printer this terminal prints on, a test page, and the Bluetooth printer picker. */
export function PrinterCheck() {
  const { terminal } = usePaired();
  const chosen = useBtPrinter();
  const bt = usePairedPrinters();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const r = route(terminal.printers?.receipt);

  async function test() {
    if (!r) return;
    setBusy(true);
    setNote(r.kind === "bluetooth" ? "Connecting…" : null);
    try {
      const bytes = testPage(r.cols, terminal.name);
      if (r.kind === "usb") {
        const st = await usbPrinterStatus().catch(() => null);
        try {
          await r.transport.send(bytes);
        } catch (e) {
          throw new Error(`${(e as Error).message}${st ? ` ${describe(st)}` : ""}`);
        }
        setNote(`Sent. Check the printer for the test page.${st ? ` ${describe(st)}` : ""}`);
      } else {
        await r.transport.send(bytes);
        setNote("Sent. Check the printer for the test page.");
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function use(p: BtPrinterPref | null) {
    setBtPrinter(p);
    setNote(null);
  }

  const btNote = !bt.state.supported ? null : !bt.state.enabled ? "Bluetooth is off. Turn it on to print on a Bluetooth printer." : !bt.allowed ? "PX POS isn't allowed to use Bluetooth (Nearby devices)." : bt.devices.length === 0 ? "No Bluetooth printer is paired with this machine yet." : null;

  return (
    <View className="border-b border-border">
      <View className="gap-1 px-4 py-2">
        <View className="min-h-11 flex-row items-center gap-3">
          <Text className="flex-1 text-sm" numberOfLines={1}>
            {r?.label ?? "No printer found"}
          </Text>
          <Button size="sm" variant="outline" disabled={busy || !r} onPress={() => void test()} accessibilityLabel="Print a test page">
            <Text>{busy ? "Printing…" : "Test print"}</Text>
          </Button>
        </View>
        {note ? <Text className="text-sm text-muted-foreground">{note}</Text> : null}
      </View>

      {bt.state.supported ? (
        <View className="gap-1 px-4 pb-2">
          <View className="min-h-11 flex-row items-center gap-3">
            <Text className="flex-1 text-sm text-muted-foreground">Bluetooth printers</Text>
            <Button size="sm" variant="ghost" onPress={() => void Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS").catch(() => {})} accessibilityLabel="Pair a Bluetooth printer">
              <Text>Pair a printer</Text>
            </Button>
          </View>
          {btNote ? <Text className="text-sm text-muted-foreground">{btNote}</Text> : null}
          {bt.devices.map((d) => {
            const inUse = chosen?.address === d.address;
            return (
              <View key={d.address} className="min-h-12 flex-row flex-wrap items-center gap-2">
                <Text className={cn("min-w-32 flex-1 text-sm", inUse && "font-semibold")} numberOfLines={1}>
                  {d.name}
                </Text>
                {inUse && chosen ? (
                  <>
                    <WidthChoice value={chosen.width} onChange={(width) => use({ ...chosen, width })} />
                    <Button size="sm" variant="ghost" onPress={() => use(null)} accessibilityLabel={`Stop printing on ${d.name}`}>
                      <Text>Stop using</Text>
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onPress={() => use({ address: d.address, name: d.name, width: 58 })} accessibilityLabel={`Print on ${d.name}`}>
                    <Text>Use this printer</Text>
                  </Button>
                )}
              </View>
            );
          })}
          {chosen && !bt.devices.some((d) => d.address === chosen.address) && bt.allowed && bt.state.enabled ? (
            <View className="min-h-12 flex-row items-center gap-2">
              <Text className="flex-1 text-sm text-warning" numberOfLines={2}>
                {chosen.name} isn&apos;t paired any more. Pair it again, or stop using it.
              </Text>
              <Button size="sm" variant="ghost" onPress={() => use(null)} accessibilityLabel={`Stop printing on ${chosen.name}`}>
                <Text>Stop using</Text>
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
