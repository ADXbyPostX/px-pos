import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Empty({ icon: Icon, label, action, className }: { icon: LucideIcon; label: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
      {action}
    </div>
  );
}
