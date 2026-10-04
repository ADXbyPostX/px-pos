"use client";

import { useMemo } from "react";
import makeQr from "qrcode-generator";
import { cn } from "@/lib/utils";

const QUIET = 3;

/** A QR code as inline SVG (dark modules on white, with a quiet zone). */
export function QrCode({ value, className, label }: { value: string; className?: string; label: string }) {
  const { n, d } = useMemo(() => {
    const q = makeQr(0, "M");
    q.addData(value);
    q.make();
    const count = q.getModuleCount();
    let path = "";
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; ) {
        if (!q.isDark(y, x)) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < count && q.isDark(y, x + run)) run++;
        path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
        x += run;
      }
    }
    return { n: count + QUIET * 2, d: path };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges" className={cn("rounded-md bg-white", className)}>
      <path d={d} fill="#000" />
    </svg>
  );
}
