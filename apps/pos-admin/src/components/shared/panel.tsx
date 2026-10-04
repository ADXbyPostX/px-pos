import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ title, action, children, className, bodyClassName }: { title?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("flex flex-col overflow-clip rounded-xl border bg-card", className)}>
      {title ? (
        <header className="sticky -top-4 z-10 flex md:-top-6 h-11 shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Key–value rows for detail views. */
export function KV({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-2.5 text-sm", className)}>
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-words">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
