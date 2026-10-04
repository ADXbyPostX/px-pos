"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Right-hand detail sheet (desktop) / bottom sheet (phone) for one record:
 * title band, scrolling body, optional footer of actions.
 */
export function RecordSheet({
  open,
  onOpenChange,
  title,
  meta,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** One short line under the title (status, number). Screen-reader description too. */
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-0 p-0", mobile ? "max-h-[94dvh] rounded-t-2xl" : "w-full sm:max-w-xl", className)}
      >
        <SheetHeader className="gap-1 border-b px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {meta ? <SheetDescription asChild><div className="text-xs text-muted-foreground">{meta}</div></SheetDescription> : <SheetDescription className="sr-only">Details</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
