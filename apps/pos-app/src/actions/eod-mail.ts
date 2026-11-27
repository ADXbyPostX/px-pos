import { getIdToken } from "@react-native-firebase/auth";
import { ADMIN_ORIGIN, type BizDate } from "@px-pos/core";
import { getAuthInstance } from "@/firebase";

/** Dev only: the admin's address when testing against local emulators. Production uses pxpos.postx.in. */
const origin = process.env.EXPO_PUBLIC_ADMIN_ORIGIN || ADMIN_ORIGIN;

/**
 * After End of day: ask PX POS Admin to email the closed day's Z report and item sales to the
 * outlet's list. It carries this till's own sign-in, so the server reads only what the till may.
 * Never blocks the close; a dropped connection is retried twice, and an admin can always send it
 * again from End of day.
 */
export async function requestEodMail(cid: string, businessDate: BizDate): Promise<void> {
  const user = getAuthInstance().currentUser;
  if (!user) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getIdToken(user);
      const res = await fetch(`${origin}/api/eod-mail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cid, businessDate, source: "app" }),
      });
      // Sent, already sent, no list, or refused: trying again won't change it. Only a server hiccup is retried.
      if (res.status !== 502) return;
    } catch {
      // Offline for a moment: wait and try again.
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
}
