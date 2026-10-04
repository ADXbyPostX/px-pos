"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RotateCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Empty } from "./empty";

/** Skeleton of the standard page: stats strip + panel grid. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} aria-busy aria-label="Loading">
      <div className="grid grid-cols-2 gap-px overflow-clip rounded-xl border lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 bg-card px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("overflow-clip rounded-xl border bg-card", className)} aria-busy aria-label="Loading">
      <div className="h-10 border-b bg-card" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-11 items-center gap-4 border-b px-3 last:border-0">
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-1/6" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function ErrorPanel({ error, onRetry, className }: { error: Error | string | null; onRetry?: () => void; className?: string }) {
  const message = typeof error === "string" ? error : error?.message ?? "Something went wrong.";
  const denied = /permission|insufficient/i.test(message);
  const indexing = /requires an index/i.test(message);
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/40 px-6 py-12 text-center", className)}>
      <AlertTriangle className="size-5 text-destructive" aria-hidden />
      <p className="max-w-md text-sm [overflow-wrap:anywhere] text-muted-foreground">
        {denied ? "You don't have access to this data." : indexing ? "Firestore is still building the index for this view. It is usually ready within a few minutes." : message}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw data-icon="inline-start" aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

type LiveLike<T> = { data: T; status: "loading" | "ready" | "error"; error: Error | null };

/**
 * The one way to render async data: skeleton → error (with retry) → empty → content.
 * Wrap every live listener with it (loading.tsx does not cover client-side listeners).
 */
export function Loadable<T>({
  state,
  skeleton,
  empty,
  isEmpty,
  onRetry,
  children,
}: {
  state: LiveLike<T>;
  skeleton?: ReactNode;
  empty?: { icon: LucideIcon; label: string; action?: ReactNode };
  isEmpty?: (data: T) => boolean;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <>{skeleton ?? <TableSkeleton />}</>;
  if (state.status === "error") return <ErrorPanel error={state.error} onRetry={onRetry} />;
  const blank = isEmpty ? isEmpty(state.data) : Array.isArray(state.data) ? state.data.length === 0 : state.data == null;
  if (blank && empty) return <Empty icon={empty.icon} label={empty.label} action={empty.action} />;
  return <>{children(state.data)}</>;
}
