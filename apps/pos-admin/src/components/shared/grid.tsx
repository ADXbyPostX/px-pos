import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Dashboard grid (px-ops): 1 → 2 → 4 columns. Wide panels use `lg:col-span-2`. */
export function Grid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4", className)}>{children}</div>;
}

/** Section heading row inside a page (icon + label + optional action). */
export function SectionTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {icon ? <span className="text-brand [&_svg]:size-4">{icon}</span> : null}
        {children}
      </h2>
      {action}
    </div>
  );
}
