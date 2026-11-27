import { cleanRecipients, eodFileNames, eodMailSubject, isBizDate, itemSales, paths, type Client, type Day, type EodMailLog, type Invoice, type Terminal } from "@px-pos/core";
import { eodMailBody } from "@/server/eod-mail-body";
import { firestoreAs, FirestoreHttpError, uidOf } from "@/server/firestore-rest";
import { EOD_FROM, MailNotSetUp, sendMail } from "@/server/mail";
import { itemSalesPdf, zReportPdf } from "@/server/pdf/eod-pdf";

// Two PDFs and one email: a few seconds, with room for a slow mail API.
export const maxDuration = 60;

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/**
 * POST /api/eod-mail { cid, businessDate, resend?, source? } with the caller's Firebase ID token.
 * Emails a closed day's Z report and item sales (PDFs) to the outlet's list (client.eodMail).
 * Everything is read and logged (eodMails/{date}) as the caller, so the database rules decide:
 * a till or admin of that outlet. The addresses come from the outlet, never from the request.
 */
export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return reply(401, { error: "Sign in first." });
  let body: { cid?: unknown; businessDate?: unknown; resend?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Send JSON." });
  }
  const cid = typeof body.cid === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.cid) ? body.cid : null;
  const date = isBizDate(body.businessDate) ? body.businessDate : null;
  if (!cid || !date) return reply(400, { error: "Which outlet and business day?" });
  const resend = body.resend === true;
  const db = firestoreAs(token);
  const logPath = paths.eodMail(cid, date);
  const now = Date.now();
  let base: Omit<EodMailLog, "status"> | null = null;

  try {
    const client = await db.get<Client>(paths.client(cid));
    if (!client) return reply(404, { error: "That outlet wasn't found." });
    const to = cleanRecipients(client.eodMail?.to);
    if (!to.length) return reply(200, { sent: false, reason: "no-list" });
    const day = await db.get<Day>(paths.day(cid, date));
    if (!day || day.status !== "closed" || !day.z) return reply(409, { error: "This day isn't closed yet." });
    const prev = await db.get<EodMailLog>(logPath);
    if (prev?.status === "sent" && !resend) return reply(200, { sent: false, reason: "already-sent", to: prev.to });
    // One send at a time, and no double taps: a failed one can be tried again straight away.
    if (prev && prev.status !== "failed" && now - prev.lastAttemptMs < 60_000) return reply(429, { error: "It was sent a moment ago. Try again in a minute." });

    base = { businessDate: date, to, attempts: (prev?.attempts ?? 0) + 1, lastAttemptMs: now, by: uidOf(token), source: body.source === "app" ? "app" : "admin", updatedAtMs: now };
    await db.set(logPath, { ...base, status: "sending" });

    const [invoices, terminals] = await Promise.all([db.where<Invoice>(paths.client(cid), "invoices", "businessDate", date), db.list<Terminal>(paths.col(cid, "terminals"))]);
    const sales = itemSales(invoices);
    const terminalNames = Object.fromEntries(terminals.map((t) => [t.id, t.name]));
    const corrections = day.corrections ?? [];
    const madeAtMs = Date.now();
    const [zPdf, itemsPdf] = await Promise.all([zReportPdf({ z: day.z, client, terminalNames, corrections, madeAtMs }), itemSalesPdf({ sales, client, businessDate: date, zNo: day.z.zNo, madeAtMs })]);
    const files = eodFileNames(day.z);
    const { html, text } = eodMailBody({ outletName: client.name, cid, z: day.z, sales, corrected: corrections.some((c) => c.kind !== "reopen") });
    const sent = await sendMail({
      from: EOD_FROM,
      to,
      subject: eodMailSubject(client.name, day.z),
      html,
      text,
      attachments: [
        { filename: files.z, content: zPdf },
        { filename: files.items, content: itemsPdf },
      ],
    });
    await db.set(logPath, { ...base, status: "sent", sentAtMs: Date.now(), messageId: sent.id, updatedAtMs: Date.now() });
    return reply(200, { sent: true, to });
  } catch (e) {
    if (e instanceof FirestoreHttpError && (e.status === 401 || e.status === 403)) return reply(403, { error: "This sign-in can't send this outlet's reports." });
    const message = e instanceof Error ? e.message : "Couldn't send the email.";
    if (base) await db.set(logPath, { ...base, status: "failed", error: message.slice(0, 300), updatedAtMs: Date.now() }).catch(() => undefined);
    return reply(e instanceof MailNotSetUp ? 503 : 502, { error: message });
  }
}
