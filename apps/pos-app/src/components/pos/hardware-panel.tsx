import { useState, type ReactNode } from "react";
import { Switch, View } from "react-native";
import { recordNoSale } from "@/actions/cash";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { customerDisplay, screens } from "@/hardware/customer-display";
import { hasDrawerPort } from "@/hardware/drawer";
import { colors } from "@/lib/colors";
import { setTilePhotos, useTilePhotos } from "@/local/prefs";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";
import { customerDisplayInfo, customerDisplayTest, openCashDrawer } from "../../../modules/pos-hardware";
import { PrinterCheck } from "./printer-check";

function Row({ label, note, children }: { label: string; note?: string | null; children?: ReactNode }) {
  return (
    <View className="gap-1 border-b border-border px-4 py-2">
      <View className="min-h-11 flex-row items-center gap-3">
        <Text className="flex-1 text-sm" numberOfLines={1}>
          {label}
        </Text>
        {children}
      </View>
      {note ? <Text className="text-sm text-muted-foreground">{note}</Text> : null}
    </View>
  );
}

/** Customer display check: draws a test picture and reports what the display acknowledged. */
function DisplayCheck() {
  const [info] = useState(customerDisplayInfo);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function test() {
    setBusy(true);
    try {
      const r = await customerDisplayTest(screens.test());
      setNote(r.acked === r.sent && r.sent > 0 ? "The display shows “PX POS · Customer display OK”." : `The display answered ${r.acked} of ${r.sent} parts${r.error ? `: ${r.error}` : ""}.`);
      setTimeout(() => customerDisplay.idle(), 5000);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Row label={info?.available ? `Customer display (${info.width}×${info.height})` : "No customer display"} note={note}>
      <Button size="sm" variant="outline" disabled={busy || !info?.available} onPress={() => void test()} accessibilityLabel="Test the customer display">
        <Text>{busy ? "Testing…" : "Test display"}</Text>
      </Button>
    </Row>
  );
}

/** Opens the cash drawer; recorded as a "no sale" so every opening is accounted for. */
function DrawerCheck() {
  const session = usePaired();
  const { operator } = useOperator();
  const data = useData();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const port = hasDrawerPort();
  async function open() {
    setBusy(true);
    try {
      await openCashDrawer();
      recordNoSale(session, operator, data.bizDate ?? data.suggestedBizDate, "Opened from the Sync screen");
      setNote("Drawer pulse sent. If it didn't open, check the drawer cable is in the CD port.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Row label={port ? "Cash drawer (opens on cash payments)" : "No cash drawer port"} note={note}>
      <Button size="sm" variant="outline" disabled={busy || !port} onPress={() => void open()} accessibilityLabel="Open the cash drawer">
        <Text>{busy ? "Opening…" : "Open drawer"}</Text>
      </Button>
    </Row>
  );
}

/** This machine's printer, customer display, cash drawer and tile photos. */
export function HardwarePanel() {
  const photos = useTilePhotos();
  return (
    <View>
      <PrinterCheck />
      <DisplayCheck />
      <DrawerCheck />
      <Row label="Dish photos on item tiles">
        <Switch value={photos} onValueChange={setTilePhotos} trackColor={{ true: colors.red, false: colors.muted }} thumbColor="#fff" accessibilityLabel="Dish photos on item tiles" />
      </Row>
    </View>
  );
}
