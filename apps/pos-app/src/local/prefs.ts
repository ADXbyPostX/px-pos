import { useSyncExternalStore } from "react";
import { getMeta, setMeta } from "./db";

/** Per-terminal display choices, kept in SQLite (survive restarts, never synced). */
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
