import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";

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
  // Messages here are shown to outlet admins as they are, so they stay plain; details go to the logs.
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new MailNotSetUp(NOT_ON);
  const { data, error } = await new Resend(key).emails.send({
    from: m.from,
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content })),
    tags: [{ name: "kind", value: "end_of_day" }],
  });
  if (error) {
    console.error("eod-mail: Resend refused the email", error.name, error.statusCode, error.message);
    // Setup not finished: no or wrong key, or the sending domain isn't verified in Resend yet.
    if (SETUP_ERRORS.has(error.name) || /domain/i.test(error.message)) throw new MailNotSetUp(NOT_ON);
    if (QUOTA_ERRORS.has(error.name)) throw new Error("Too many emails were sent today. Try again later.");
    throw new Error(`The email service refused it: ${error.message}`);
  }
  return { id: data.id };
}

const NOT_ON = "Email sending isn't switched on yet. PostX is setting it up.";
const SETUP_ERRORS = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key", "invalid_from_address", "invalid_access", "security_error"]);
const QUOTA_ERRORS = new Set(["daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded"]);
