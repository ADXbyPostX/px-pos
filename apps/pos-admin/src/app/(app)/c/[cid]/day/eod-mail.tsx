"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Mail, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cleanRecipients, MAX_EOD_RECIPIENTS, normalizeEmail, paths, updateClientPlan, validateEmail, type BizDate, type EodMailLog } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError } from "@/components/shared/form-controls";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { requestEodMail } from "@/lib/eod-mail";
import { useDoc } from "@/lib/firebase/hooks";
import { fmtDateTime } from "@/lib/format";
import { useRunPlan } from "@/lib/run-plan";

const people = (n: number) => `${n} address${n === 1 ? "" : "es"}`;

/** The outlet's end-of-day email list (client.eodMail): who gets the Z report and item sales when a day closes. */
export function EodMailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fresh copy of the saved list each time it opens — adjusted during render.
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) {
      setList(cleanRecipients(client.eodMail?.to));
      setDraft("");
      setError(null);
    }
  }

  function add(e?: FormEvent) {
    e?.preventDefault();
    const parts = draft.split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) return setError("Enter an email address.");
    for (const p of parts) {
      const bad = validateEmail(p);
      if (bad) return setError(bad);
    }
    const next = cleanRecipients([...list, ...parts]);
    if (list.length + parts.filter((p) => !list.includes(normalizeEmail(p))).length > MAX_EOD_RECIPIENTS) return setError(`Up to ${MAX_EOD_RECIPIENTS} addresses.`);
    setList(next);
    setDraft("");
    setError(null);
  }

  async function save() {
    // A typed address that wasn't added yet still counts.
    let final = list;
    if (draft.trim()) {
      const bad = draft.split(/[\s,;]+/).filter(Boolean).map(validateEmail).find(Boolean);
      if (bad) return setError(bad);
      final = cleanRecipients([...list, ...draft.split(/[\s,;]+/)]);
    }
    const plan = updateClientPlan(planCtx(cid), client, { eodMail: { to: final, updatedAtMs: Date.now() } }, "client.eod_mail");
    if (await run(plan, final.length ? `Reports will go to ${people(final.length)}` : "End-of-day email is off")) onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title="End-of-day email"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save list
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">When a day closes, on the till or here, its Z report and item sales go to these addresses as PDFs.</p>
        <form onSubmit={add} className="flex gap-2" noValidate>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} type="email" inputMode="email" autoComplete="off" placeholder="owner@example.com" aria-label="Email address to add" className="flex-1" />
          <Button type="submit" variant="outline" disabled={list.length >= MAX_EOD_RECIPIENTS}>
            <Plus data-icon="inline-start" aria-hidden />
            Add
          </Button>
        </form>
        <FormError error={error} />
        {list.length ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {list.map((e) => (
              <li key={e} className="flex items-center gap-3 py-1 pr-1 pl-3">
                <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{e}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setList((l) => l.filter((x) => x !== e))} aria-label={`Remove ${e}`}>
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No addresses yet, so no email goes out.</p>
        )}
        <p className="text-muted-foreground">
          {list.length}/{MAX_EOD_RECIPIENTS} addresses.
        </p>
      </div>
    </FormDialog>
  );
}

/** A closed day's email: sent / failed / not yet, with Send (again). */
export function EodMailStatus({ businessDate }: { businessDate: BizDate }) {
  const { cid, client } = useClient();
  const log = useDoc<EodMailLog>(paths.eodMail(cid, businessDate));
  const [busy, setBusy] = useState(false);
  const listed = cleanRecipients(client.eodMail?.to).length;
  const l = log.data;
  if (!listed && !l) return null;

  async function send() {
    setBusy(true);
    try {
      const r = await requestEodMail(cid, businessDate, { resend: l?.status === "sent" });
      if (r.error) toast.error(r.error);
      else if (r.sent) toast.success(`Reports sent to ${people(r.to?.length ?? 0)}`);
      else if (r.reason === "no-list") toast.info("Add addresses under Email list first.");
    } catch {
      toast.error("Couldn't reach PX POS. Check the internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  const text = !l
    ? "Not emailed yet."
    : l.status === "sent"
      ? `Emailed to ${people(l.to.length)}, ${fmtDateTime(l.sentAtMs ?? l.lastAttemptMs)}.`
      : l.status === "sending"
        ? "Sending the reports…"
        : `The email didn't go: ${l.error ?? "unknown error"}`;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
      <Mail className={l?.status === "failed" ? "size-4 text-brand" : "size-4 text-muted-foreground"} aria-hidden />
      <span className={l?.status === "failed" ? "min-w-0 flex-1 text-brand" : "min-w-0 flex-1 text-muted-foreground"}>{text}</span>
      {listed ? (
        <Button size="sm" variant="outline" disabled={busy || l?.status === "sending"} onClick={() => void send()}>
          {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
          {l?.status === "sent" ? "Send again" : l?.status === "failed" ? "Try again" : "Send reports"}
        </Button>
      ) : null}
    </div>
  );
}
