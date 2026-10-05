import { useSyncExternalStore } from "react";
import { getMeta, setMeta } from "./db";

/** Per-terminal choices (display, printer), kept in SQLite (survive restarts, never synced). */
const KEY_TILE_PHOTOS = "pref:tilePhotos";
const listeners = new Set<() => void>();
let tilePhotos: boolean | null = null;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function tilePhotosOn(): boolean {
  if (tilePhotos == null) tilePhotos = getMeta(KEY_TILE_PHOTOS) !== "off";
  return tilePhotos;
}

export function setTilePhotos(on: boolean): void {
  setMeta(KEY_TILE_PHOTOS, on ? null : "off");
  tilePhotos = on;
  for (const l of listeners) l();
}

/** Show dish photos on the item tiles (on by default). */
export function useTilePhotos(): boolean {
  return useSyncExternalStore(subscribe, tilePhotosOn);
}

/** The Bluetooth printer this machine prints on, chosen on the Sync screen (Hardware). */
export interface BtPrinterPref {
  address: string;
  name: string;
  width: 58 | 80;
}
const KEY_BT_PRINTER = "pref:btPrinter";
let btPrinter: BtPrinterPref | null | undefined;

export function btPrinterPref(): BtPrinterPref | null {
  if (btPrinter === undefined) {
    try {
      const raw = getMeta(KEY_BT_PRINTER);
      btPrinter = raw ? (JSON.parse(raw) as BtPrinterPref) : null;
    } catch {
      btPrinter = null;
    }
  }
  return btPrinter;
}

export function setBtPrinter(p: BtPrinterPref | null): void {
  setMeta(KEY_BT_PRINTER, p ? JSON.stringify(p) : null);
  btPrinter = p;
  for (const l of listeners) l();
}

export function useBtPrinter(): BtPrinterPref | null {
  return useSyncExternalStore(subscribe, btPrinterPref);
}
