import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

/*
 * Sending email from pos-admin over plain SMTP: by default Gmail (smtp.gmail.com:465) with the
 * mailbox's app password. Settings live only in Vercel's environment variables:
 *   SMTP_USER   the mailbox, e.g. a Gmail address
 *   SMTP_PASS   its app password (Google Account › Security › App passwords)
 *   SMTP_HOST / SMTP_PORT   another provider (default smtp.gmail.com / 465)
 *   EOD_MAIL_FROM   the From line (default "PX POS <SMTP_USER>"; Gmail only sends as its own
 *                   address or an alias set up in Gmail)
 * Local demo mode can set EOD_MAIL_DRY_RUN_DIR instead: the message and its attachments are
 * written there and nothing is sent.
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

/** The From line: EOD_MAIL_FROM, else "PX POS <the SMTP mailbox>". */
export function eodFrom(): string {
  return process.env.EOD_MAIL_FROM || `PX POS <${process.env.SMTP_USER?.trim() || "reports@pxpos.postx.in"}>`;
}

/** Setup isn't finished; the reason in brackets tells PostX which step is missing. */
const notOn = (why: string) => new MailNotSetUp(`Email sending isn't switched on yet. PostX is setting it up. (${why})`);

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
  const user = process.env.SMTP_USER?.trim();
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"): spaces don't count.
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, "");
  if (!user || !pass) throw notOn("no email account set on the server yet");
  const port = Number(process.env.SMTP_PORT) || 465;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transport.sendMail({
      from: m.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: "application/pdf" })),
    });
    if (!info.accepted.length) throw Object.assign(new Error(`every address was refused (${info.rejected.join(", ")})`), { code: "EENVELOPE" });
    return { id: info.messageId };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    console.error("eod-mail: SMTP send failed", err.code, err.responseCode, err.message);
    if (err.code === "EAUTH" || err.responseCode === 535 || err.responseCode === 534) throw notOn("the email password was refused: it needs an app password");
    if (/limit|quota/i.test(err.message ?? "") && [421, 454, 550].includes(err.responseCode ?? 0)) throw new Error("Too many emails were sent today. Try again later.");
    if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET"].includes(err.code ?? "")) throw new Error("Couldn't reach the mail server. Try again in a minute.");
    throw new Error(`The mail server refused it: ${err.message ?? "unknown error"}`);
  } finally {
    transport.close();
  }
}
