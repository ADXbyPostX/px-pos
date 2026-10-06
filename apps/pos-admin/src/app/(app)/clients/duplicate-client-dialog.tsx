"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDocFromServer, getDocsFromServer } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { duplicateClientPlans, makeClientId, paths, type Category, type Client, type ClientCopySource, type ClientCollection, type Floor, type Item, type ItemPhoto, type Table } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError } from "@/components/shared/form-controls";
import { usePrincipal } from "@/components/providers/principal-provider";
import { getDb } from "@/lib/firebase/client";
import { firestoreMessage } from "@/lib/firebase/apply-plan";
import { cryptoRand } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";

/** Read the source fresh from the server: the copy must not come from a stale offline cache. */
async function readSource(cid: string): Promise<ClientCopySource> {
  const db = getDb();
  const all = async <T,>(col: ClientCollection) => (await getDocsFromServer(collection(db, paths.col(cid, col)))).docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  const snap = await getDocFromServer(doc(db, paths.client(cid)));
  if (!snap.exists()) throw new Error("That client no longer exists.");
  const [categories, items, photos, floors, tables] = await Promise.all([all<Category>("categories"), all<Item>("items"), all<ItemPhoto>("itemPhotos"), all<Floor>("floors"), all<Table>("tables")]);
  return { client: snap.data() as Client, categories, items, photos, floors, tables };
}

/**
 * Super admin: a new client set up like this one (settings, receipt logo, menu, photos, tables),
 * e.g. an internal test outlet. Staff, terminals, admins, sales and the outlet's GSTIN, FSSAI,
 * phone and UPI ID stay behind.
 */
export function DuplicateClientDialog({ source, open, onOpenChange }: { source: { id: string; name: string } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = reading || pending;

  async function copy() {
    if (!source) return;
    const n = name.trim();
    if (!n) return setError("Give the new client a name");
    if (n.length > 60) return setError("Keep the name under 60 characters");
    setError(null);
    setReading(true);
    let src: ClientCopySource;
    try {
      src = await readSource(source.id);
    } catch (e) {
      setError(firestoreMessage(e));
      return;
    } finally {
      setReading(false);
    }
    const cid = makeClientId(n, cryptoRand);
    if (await run(duplicateClientPlans(planCtx(cid), src, n), `${n} created with ${src.items.length} items`)) {
      onOpenChange(false);
      setName("");
      router.push(`/c/${cid}`);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={source ? `Duplicate ${source.name}` : "Duplicate client"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void copy()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {reading ? "Reading menu…" : pending ? "Copying…" : "Duplicate"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="New client name" htmlFor="dup-name">
          <Input id="dup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Post Office Cafe Test" maxLength={60} autoFocus />
        </Field>
        <p className="text-sm text-muted-foreground">
          Copies the settings, receipt logo, categories, items, photos, floors and tables. Staff, terminals, admins and sales aren&apos;t copied, and neither are the GSTIN, FSSAI, phone or UPI ID, so the copy can&apos;t bill or take payments as the real outlet.
        </p>
        <FormError error={error} />
      </div>
    </FormDialog>
  );
}
