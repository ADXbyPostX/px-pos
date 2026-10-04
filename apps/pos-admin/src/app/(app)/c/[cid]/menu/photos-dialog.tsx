"use client";

import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ImageUp, Loader2 } from "lucide-react";
import { combinePlans, itemPhotoPlan, matchPhotoFiles, type Item } from "@px-pos/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SelectField } from "@/components/shared/form-controls";
import { FormDialog } from "@/components/shared/form-dialog";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { prepareItemPhoto, type PreparedPhoto } from "@/lib/photo";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";
import { ItemThumb } from "./item-photo";

const SKIP = "__skip";
/** Photos per batch: ~60 KB each keeps a batch far under Firestore's request limit. */
const PER_BATCH = 8;

type Row = { key: string; file: string; photo: PreparedPhoto | null; error: string | null; itemId: string; note: "duplicate" | "ambiguous" | "none" | null };

/** Bulk photo upload: pick photos named after the dishes, check the matches, upload them in one go. */
export function PhotosDialog({ open, onOpenChange, items, photos }: { open: boolean; onOpenChange: (o: boolean) => void; items: WithId<Item>[]; photos: Map<string, string> }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const options = useMemo(() => [{ value: SKIP, label: "Don’t upload" }, ...[...items].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ value: i.id, label: photos.has(i.id) ? `${i.name} (has a photo)` : i.name }))], [items, photos]);

  const chosen = rows.filter((r) => r.photo && r.itemId !== SKIP);
  const chosenIds = new Set(chosen.map((r) => r.itemId));
  const clash = chosen.length !== chosenIds.size;
  const missing = items.filter((i) => i.active && !photos.has(i.id) && !chosenIds.has(i.id));
  const withPhoto = items.filter((i) => i.active && photos.has(i.id)).length;
  const active = items.filter((i) => i.active).length;

  function close(o: boolean) {
    if (pending || reading) return;
    if (!o) setRows([]);
    onOpenChange(o);
  }

  async function take(list: FileList | File[]) {
    const files = [...list].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!files.length) return;
    const matches = matchPhotoFiles(
      files.map((f) => f.name),
      items.filter((i) => i.active),
    );
    setReading({ done: 0, total: files.length });
    const next: Row[] = [];
    for (const [k, f] of files.entries()) {
      const m = matches[k]!;
      let photo: PreparedPhoto | null = null;
      let error: string | null = null;
      try {
        photo = await prepareItemPhoto(f);
      } catch (e) {
        error = (e as Error).message;
      }
      next.push({ key: `${f.name}-${f.size}-${f.lastModified}-${k}`, file: f.name, photo, error, itemId: m.status === "matched" ? m.itemId : SKIP, note: m.status === "matched" ? null : m.status });
      setReading({ done: k + 1, total: files.length });
    }
    setRows((r) => [...r, ...next]);
    setReading(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen.length || clash) return;
    const ctx = planCtx(cid);
    const plans = chosen.map((r) => itemPhotoPlan(ctx, { itemId: r.itemId, itemName: byId.get(r.itemId)?.name ?? r.itemId, photo: r.photo!, hadPhoto: photos.has(r.itemId) }));
    const batches = [];
    for (let i = 0; i < plans.length; i += PER_BATCH) batches.push(combinePlans(`Upload ${Math.min(PER_BATCH, plans.length - i)} photos`, plans.slice(i, i + PER_BATCH)));
    if (await run(batches, `${plans.length} photo${plans.length === 1 ? "" : "s"} uploaded`)) close(false);
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title="Item photos"
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={pending || Boolean(reading)}>
            Cancel
          </Button>
          <Button type="submit" form="photos-form" disabled={pending || Boolean(reading) || chosen.length === 0 || clash}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {chosen.length ? `Upload ${chosen.length} photo${chosen.length === 1 ? "" : "s"}` : "Upload photos"}
          </Button>
        </>
      }
    >
      <form id="photos-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center", over && "border-primary bg-primary/5")}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const list = e.target.files ? [...e.target.files] : [];
              e.target.value = "";
              void take(list);
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={Boolean(reading) || pending}>
            <ImageUp data-icon="inline-start" aria-hidden />
            Choose photos
          </Button>
          <p className="text-sm text-muted-foreground">Name each file after its dish, like “Ginger Tea.jpg”, or drop them here.</p>
          {reading ? <Progress value={(reading.done / reading.total) * 100} className="w-48" aria-label={`Reading photo ${reading.done} of ${reading.total}`} /> : null}
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {withPhoto} of {active} items have a photo
          {missing.length ? ` · still missing: ${missing.slice(0, 8).map((i) => i.name).join(", ")}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}` : ""}
        </p>
        {clash ? (
          <p role="alert" className="text-sm text-destructive">
            Two photos are set for the same item. Pick a different item or “Don’t upload” for one of them.
          </p>
        ) : null}

        {rows.length ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-3 py-2">
                <ItemThumb uri={r.photo?.uri} className="size-12" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 truncate text-sm sm:w-48" title={r.file}>
                    {r.file}
                  </span>
                  {r.error ? (
                    <span className="text-sm text-destructive">{r.error}</span>
                  ) : (
                    <SelectField
                      value={r.itemId}
                      onValueChange={(v) => setRows((all) => all.map((x) => (x.key === r.key ? { ...x, itemId: v, note: null } : x)))}
                      options={options}
                      className="sm:max-w-64"
                      aria-label={`Item for ${r.file}`}
                    />
                  )}
                </div>
                {r.error ? null : r.itemId === SKIP ? (
                  <Badge variant="outline" className="text-warning">
                    {r.note === "duplicate" ? "Second photo" : r.note === "ambiguous" ? "Pick the item" : "No match"}
                  </Badge>
                ) : photos.has(r.itemId) ? (
                  <Badge variant="outline">Replaces</Badge>
                ) : (
                  <Badge variant="outline" className="text-success">
                    New
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </FormDialog>
  );
}
