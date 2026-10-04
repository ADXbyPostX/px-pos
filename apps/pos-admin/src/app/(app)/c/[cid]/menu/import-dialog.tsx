"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { formatINR, ORDER_MODES, parseMenuImport, planMenuImport, rateLabel, type Category, type Item } from "@px-pos/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";

const EXAMPLE = `Category,Item,Price,GST %,Station,Variants
Hot Drinks,Masala Tea,25,5,Beverage,
Coffee,Cappuccino,,5,Beverage,Regular:120|Large:150
Snacks,Veg Puff,30,5,Kitchen,`;

/** Paste a menu (CSV or straight from a spreadsheet), check the preview, add it in one go. */
export function ImportDialog({ open, onOpenChange, categories, items }: { open: boolean; onOpenChange: (o: boolean) => void; categories: WithId<Category>[]; items: WithId<Item>[] }) {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const modes = useMemo(() => ORDER_MODES.filter((m) => client.orderModes[m]), [client.orderModes]);
  const existing = useMemo(() => ({ categories, items, modes }), [categories, items, modes]);
  const parsed = useMemo(() => parseMenuImport(text), [text]);
  const preview = useMemo(() => planMenuImport(planCtx(cid), parsed.rows, existing, newId), [planCtx, cid, parsed.rows, existing]);
  const errors = [...parsed.errors, ...preview.errors].sort((a, b) => a.line - b.line);
  const skipped = new Set(preview.skipped);

  function close(o: boolean) {
    if (pending) return;
    if (!o) {
      setText("");
      setFileError(null);
    }
    onOpenChange(o);
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) return setFileError("That file is too big for a menu (over 512 KB).");
    setFileError(null);
    setText(await file.text());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (errors.length || preview.added.length === 0) return;
    // Fresh ids and timestamps for the real write.
    const plan = planMenuImport(planCtx(cid), parsed.rows, existing, newId);
    const n = plan.added.length;
    if (await run(plan.plans, `${n} item${n === 1 ? "" : "s"} added`)) close(false);
  }

  const ready = parsed.rows.length > 0;
  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title="Import menu"
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="import-form" disabled={pending || errors.length > 0 || preview.added.length === 0}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {preview.added.length ? `Add ${preview.added.length} item${preview.added.length === 1 ? "" : "s"}` : "Add items"}
          </Button>
        </>
      }
    >
      <form id="import-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Menu rows" htmlFor="import-text">
          <Textarea id="import-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} rows={8} spellCheck={false} className="font-mono text-xs" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={pickFile} className="sr-only" tabIndex={-1} aria-hidden />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <FileUp data-icon="inline-start" aria-hidden />
            Choose CSV file
          </Button>
          {ready ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {preview.added.length} new item{preview.added.length === 1 ? "" : "s"}
              {preview.newCategories.length ? ` · ${preview.newCategories.length} new categor${preview.newCategories.length === 1 ? "y" : "ies"}` : ""}
              {preview.skipped.length ? ` · ${preview.skipped.length} already on the menu` : ""}
            </p>
          ) : null}
        </div>

        {fileError || errors.length ? (
          <ul role="alert" className="flex flex-col gap-1 text-sm text-destructive">
            {fileError ? <li>{fileError}</li> : null}
            {errors.map((er) => (
              <li key={`${er.line}-${er.message}`}>
                Line {er.line}: {er.message}
              </li>
            ))}
          </ul>
        ) : null}

        {ready ? (
          <div className="overflow-clip rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.rows.map((r) => (
                  <TableRow key={r.line} className={skipped.has(r) ? "text-muted-foreground" : undefined}>
                    <TableCell>{r.category}</TableCell>
                    <TableCell>
                      {r.name}
                      {r.variants.length ? <span className="text-muted-foreground"> · {r.variants.map((v) => `${v.name} ${formatINR(v.pricePaise, { decimals: "auto" })}`).join(", ")}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.pricePaise, { decimals: "auto" })}</TableCell>
                    <TableCell className="text-right tabular-nums">{rateLabel(r.taxBps)}</TableCell>
                    <TableCell className="text-right">{skipped.has(r) ? <Badge variant="outline">On menu</Badge> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </form>
    </FormDialog>
  );
}
