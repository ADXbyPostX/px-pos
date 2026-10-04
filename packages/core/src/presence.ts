/** Terminal presence from the last heartbeat (server-timestamped). Port of pxclusive-admin/src/lib/presence.ts. */
export type Presence = "online" | "stale" | "offline" | "never";

export const ONLINE_MS = 3 * 60_000;
export const STALE_MS = 30 * 60_000;

export function presence(lastSeenMs: number | undefined | null, nowMs: number): Presence {
  if (!lastSeenMs) return "never";
  const age = nowMs - lastSeenMs;
  if (age <= ONLINE_MS) return "online";
  if (age <= STALE_MS) return "stale";
  return "offline";
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Online",
  stale: "Stale",
  offline: "Offline",
  never: "Never seen",
};

/** Clock skew (device − server) above which the app warns and admin flags the terminal. */
export const SKEW_WARN_MS = 2 * 60_000;
