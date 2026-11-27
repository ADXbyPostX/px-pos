import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * Sending email from pos-admin. Production goes through Resend (Vercel Marketplace integration,
 * RESEND_API_KEY). Local demo mode can set EOD_MAIL_DRY_RUN_DIR instead: the message and its
 * attachments are written there and nothing is sent.
 */

export interface Mail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}

export class MailNotSetUp extends Error {}

/** "PX POS <reports@pxpos.postx.in>" unless EOD_MAIL_FROM says otherwise. */
export const EOD_FROM = process.env.EOD_MAIL_FROM || "PX POS <reports@pxpos.postx.in>";

export async function sendMail(m: Mail): Promise<{ id: string }> {
  const dry = process.env.EOD_MAIL_DRY_RUN_DIR;
  // Local demo mode only: production never runs against the emulators.
  if (dry && process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST) {
    const dir = path.join(dry, `${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "message.json"), JSON.stringify({ from: m.from, to: m.to, subject: m.subject, text: m.text }, null, 2));
    await writeFile(path.join(dir, "body.html"), m.html);
    for (const a of m.attachments) await writeFile(path.join(dir, a.filename), a.content);
    return { id: `dry-run:${dir}` };
  }
  // Shown to outlet admins as is, so it stays plain. (Setup: connect Resend to px-pos on Vercel.)
  if (!process.env.RESEND_API_KEY) throw new MailNotSetUp("Email sending isn't switched on yet. PostX is setting it up.");
  throw new MailNotSetUp("Email sending isn't switched on yet. PostX is setting it up.");
}
