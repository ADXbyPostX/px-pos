import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { testPage } from "@/print/encode";
import { builtInPrinter, lanPrinter } from "@/print/transport";
import { usePaired } from "@/state/session";
import { usbPrinterStatus, type UsbPrinterStatus } from "../../../modules/pos-hardware";

const hex = (n: number | null) => (n == null ? "–" : `0x${n.toString(16).padStart(2, "0")}`);
function describe(st: UsbPrinterStatus): string {
  if (!st.answered) return "The printer didn't report its status.";
  const state = st.coverOpen ? "cover open" : st.paperOut ? "out of paper" : st.error ? "printer error" : "ready";
  return `Printer says: ${state} (status ${hex(st.printer)} ${hex(st.offline)} ${hex(st.roll)})`;
}

/** Which printer this terminal prints on, with a test page — the first check on a new machine. */
export function PrinterCheck() {
  const { terminal } = usePaired();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lan = terminal.printers?.receipt?.host ? terminal.printers.receipt : null;
  const usb = lan ? null : builtInPrinter();
  const label = lan ? `Network printer ${lan.host}` : usb ? `Built-in printer (${usb.name})` : "No printer found";

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const cols = lan ? (lan.width === 58 ? 32 : 48) : 32;
      const bytes = testPage(cols, terminal.name);
      if (lan) {
        await lanPrinter({ host: lan.host, port: lan.port || 9100 }).send(bytes);
        setNote("Sent. Check the printer for the test page.");
      } else if (usb) {
        const st = await usbPrinterStatus().catch(() => null);
        try {
          await usb.transport.send(bytes);
        } catch (e) {
          throw new Error(`${(e as Error).message}${st ? ` ${describe(st)}` : ""}`);
        }
        setNote(`Sent. Check the printer for the test page.${st ? ` ${describe(st)}` : ""}`);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-1 border-b border-border px-4 py-2">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-sm" numberOfLines={1}>
          {label}
        </Text>
        <Button size="sm" variant="outline" disabled={busy || (!lan && !usb)} onPress={() => void test()} accessibilityLabel="Print a test page">
          <Text>{busy ? "Printing…" : "Test print"}</Text>
        </Button>
      </View>
      {note ? <Text className="text-sm text-muted-foreground">{note}</Text> : null}
    </View>
  );
}
