"use client";

import { useState, type FormEvent } from "react";
import { collection, doc, getDocs, limit, query, runTransaction, where } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fyFor, isPairingCode, nextTerminalCode, normalizePairingCode, pairPlan, paths, seriesFor, type Client, type PairingRequest, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, SelectField } from "@/components/shared/form-controls";
import { usePrincipal } from "@/components/providers/principal-provider";
import { applyPlanInTx, firestoreMessage } from "@/lib/firebase/apply-plan";
import { getDb } from "@/lib/firebase/client";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";

/**
 * Pair a tablet showing a PXP-XXXX-XXXX code to this client. Runs in a transaction that
 * re-reads the request (must still be pending). Each terminal gets a never-reused code char,
 * which is also its own GST invoice series.
 */
export function PairDialog({
  open,
  onOpenChange,
  client,
  terminals,
  initialCode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: WithId<Client>;
  terminals: Array<WithId<Terminal>>;
  initialCode?: string;
}) {
  const { planCtx } = usePrincipal();
  const [code, setCode] = useState(initialCode ?? "");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"pos" | "kds">("pos");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const termCode = nextTerminalCode(terminals.map((t) => t.code));

  // Prefill the code each time the dialog opens with one (or it changes while open) — adjusted during render.
  const prefill = open && initialCode ? initialCode : null;
  const [seenPrefill, setSeenPrefill] = useState(prefill);
  if (prefill !== seenPrefill) {
    setSeenPrefill(prefill);
    if (prefill) setCode(prefill);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePairingCode(code);
    if (!isPairingCode(normalized)) return setError("Enter the code shown on the tablet, like PXP-7K2Q-9M4D");
    if (!name.trim()) return setError("Give the terminal a name, e.g. Counter or Kitchen");
    if (!termCode) return setError("This client has used every terminal code");
    setError(null);
    setPending(true);
    try {
      const db = getDb();
      const found = await getDocs(query(collection(db, paths.pairingRequests()), where("code", "==", normalized), where("status", "==", "pending"), limit(2)));
      if (found.empty) throw new Error("No tablet is waiting with that code. Check the code on the tablet screen.");
      if (found.size > 1) throw new Error("Two tablets show this code. Restart one of them to get a new code.");
      const requestRef = found.docs[0]!.ref;
      const terminalId = newId();
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(doc(db, requestRef.path));
        const req = snap.data() as PairingRequest | undefined;
        if (!req || req.status !== "pending") throw new Error("That tablet was just paired or rejected. Ask it for a new code.");
        const plan = pairPlan(planCtx(client.id), {
          requestUid: snap.id,
          terminalId,
          code: termCode,
          name: name.trim(),
          mode,
          series: seriesFor(client.invoicePrefix, termCode),
          platform: req.platform,
          model: req.model,
          appVersion: req.appVersion,
          fy: fyFor(Date.now()),
        });
        applyPlanInTx(tx, plan);
      });
      toast.success(`${name.trim()} paired as terminal ${termCode}`);
      setCode("");
      setName("");
      setMode("pos");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && !("code" in err) ? err.message : firestoreMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!pending) {
          setError(null);
          onOpenChange(o);
        }
      }}
      title="Pair terminal"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="pair-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Pair
          </Button>
        </>
      }
    >
      <form id="pair-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Code on the tablet" htmlFor="p-code">
          <Input id="p-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PXP-XXXX-XXXX" className="font-mono text-base tracking-wider uppercase" autoFocus autoComplete="off" />
        </Field>
        <FieldRow>
          <Field label="Terminal name" htmlFor="p-name">
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter" maxLength={30} />
          </Field>
          <Field label="Use as" htmlFor="p-mode">
            <SelectField
              id="p-mode"
              value={mode}
              onValueChange={setMode}
              options={[
                { value: "pos", label: "Billing terminal" },
                { value: "kds", label: "Kitchen display" },
              ]}
            />
          </Field>
        </FieldRow>
        <p className="text-sm text-muted-foreground">
          Terminal code <span className="font-mono text-foreground">{termCode ?? "—"}</span> · invoice series{" "}
          <span className="font-mono text-foreground">{termCode ? seriesFor(client.invoicePrefix, termCode) : "—"}</span>
        </p>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}
