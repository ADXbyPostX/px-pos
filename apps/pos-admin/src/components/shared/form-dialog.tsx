"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** Buttons row. Submit buttons should target the form via the `form` attribute. */
  footer?: ReactNode;
  className?: string;
};

/** Dialog on desktop, bottom sheet on phones. Same content either way. */
export function FormDialog({ open, onOpenChange, title, children, footer, className }: Props) {
  const mobile = useIsMobile();

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex max-h-[94dvh] flex-col gap-0 rounded-t-2xl p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-lg", className)}>
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t px-5 py-4">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}
