"use client";

import { useRef, useState, type DragEvent } from "react";
import { ImageIcon, ImageUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareItemPhoto, type PreparedPhoto } from "@/lib/photo";
import { cn } from "@/lib/utils";

/** Square item photo, or a dashed placeholder when it has none. */
export function ItemThumb({ uri, className }: { uri: string | null | undefined; className?: string }) {
  if (uri) {
    // Inline data URI from Firestore: next/image can't optimise it and needn't.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={uri} alt="" className={cn("size-9 shrink-0 rounded-md object-cover", className)} />;
  }
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground", className)} aria-hidden>
      <ImageIcon className="size-4" />
    </span>
  );
}

/** Photo picker for the item form: click or drop a photo; it's squared and shrunk before saving. */
export function PhotoField({ uri, name, onChange, onRemove }: { uri: string | null; name: string; onChange: (p: PreparedPhoto) => void; onRemove: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await prepareItemPhoto(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn("relative size-24 shrink-0 overflow-clip rounded-xl border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring", over && "ring-2 ring-primary", !uri && "border-dashed")}
          aria-label={uri ? `Replace the photo of ${name || "this item"}` : `Add a photo of ${name || "this item"}`}
        >
          {uri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uri} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="mx-auto size-6 text-muted-foreground" aria-hidden />
          )}
          {busy ? (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="size-5 animate-spin" aria-hidden />
            </span>
          ) : null}
        </button>
        <div className="flex flex-col items-start gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void take(f);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImageUp data-icon="inline-start" aria-hidden />
            {uri ? "Replace photo" : "Add photo"}
          </Button>
          {uri ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
              <Trash2 data-icon="inline-start" aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
