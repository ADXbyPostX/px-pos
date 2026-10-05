"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import type { ReceiptLogo } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { inkShare, LOGO_SIZES, loadLogoSource, logoPreviewUrl, looksWhite, makeReceiptLogo, type LogoOptions, type LogoSize } from "@/lib/receipt-logo";
import { cn } from "@/lib/utils";

/**
 * Receipt logo: drop or pick a PNG; it's turned into the black-and-white dots the printer draws
 * (shown exactly as it will print). Size, style and invert re-render it while the dropped image
 * is still open on this page.
 */
export function ReceiptLogoField({ value, onChange }: { value: ReceiptLogo | undefined; onChange: (logo: ReceiptLogo | undefined) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [white, setWhite] = useState(false);
  const [opts, setOpts] = useState<LogoOptions>({ size: "m", shaded: false, invert: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const url = useMemo(() => (value ? logoPreviewUrl(value) : null), [value]);
  const mostlyBlack = useMemo(() => (value ? inkShare(value) > 0.55 : false), [value]);

  function render(source: HTMLCanvasElement, o: LogoOptions) {
    try {
      onChange(makeReceiptLogo(source, o));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const s = await loadLogoSource(file);
      setSrc(s);
      setWhite(looksWhite(s));
      render(s, opts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function change(patch: Partial<LogoOptions>) {
    const o = { ...opts, ...patch };
    setOpts(o);
    if (src) render(src, o);
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn(
            "relative flex h-24 w-56 shrink-0 items-center justify-center overflow-clip rounded-xl border px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            url ? "bg-white" : "border-dashed bg-muted/40",
            over && "ring-2 ring-primary",
          )}
          aria-label={url ? "Replace the receipt logo (drop a PNG here)" : "Add a receipt logo (drop a PNG here)"}
        >
          {url ? (
            // Inline data URI, one pixel per printer dot: next/image can't optimise it and needn't.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="max-h-full max-w-full object-contain [image-rendering:pixelated]" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
              <ImageUp className="size-5" aria-hidden />
              Drop a PNG logo
            </span>
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
            accept="image/png,image/jpeg,image/webp"
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
            {value ? "Replace logo" : "Choose PNG"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSrc(null);
                setError(null);
                onChange(undefined);
              }}
              disabled={busy}
            >
              <Trash2 data-icon="inline-start" aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {src && value ? (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={opts.size} onValueChange={(v) => v && change({ size: v as LogoSize })} aria-label="Logo size">
            {(Object.keys(LOGO_SIZES) as LogoSize[]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="px-3">
                {LOGO_SIZES[k].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" value={opts.shaded ? "shaded" : "sharp"} onValueChange={(v) => v && change({ shaded: v === "shaded" })} aria-label="Logo style">
            <ToggleGroupItem value="sharp" className="px-3">Sharp</ToggleGroupItem>
            <ToggleGroupItem value="shaded" className="px-3">Shaded</ToggleGroupItem>
          </ToggleGroup>
          <Toggle variant="outline" size="sm" pressed={opts.invert} onPressedChange={(invert) => change({ invert })} className="px-3">
            Invert
          </Toggle>
        </div>
      ) : null}

      {src && white && !opts.invert ? <p className="text-sm text-warning">This logo is white, so it won&apos;t show on paper. Turn on Invert to print it in black.</p> : null}
      {value && mostlyBlack ? <p className="text-sm text-warning">This prints mostly black. If the logo is light on a dark background, {src ? "turn on Invert" : "drop it again and turn on Invert"}.</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
