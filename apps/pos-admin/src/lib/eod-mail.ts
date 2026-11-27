"use client";

import type { BizDate } from "@px-pos/core";
import { getAuthInstance } from "@/lib/firebase/client";

export interface EodMailResult {
  sent: boolean;
  to?: string[];
  reason?: "no-list" | "already-sent";
  error?: string;
}

/**
 * Ask pos-admin to email a closed day's Z report and item sales to the outlet's list. The request
 * carries this browser's own sign-in, so the server can only read what this admin can.
 */
export async function requestEodMail(cid: string, businessDate: BizDate, opts: { resend?: boolean } = {}): Promise<EodMailResult> {
  const user = getAuthInstance().currentUser;
  if (!user) return { sent: false, error: "Sign in again, then send." };
  const token = await user.getIdToken();
  const res = await fetch("/api/eod-mail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cid, businessDate, resend: opts.resend === true, source: "admin" }),
  });
  const body = (await res.json().catch(() => ({}))) as EodMailResult;
  if (!res.ok) return { sent: false, error: body.error ?? `Couldn't send (${res.status}).` };
  return body;
}
