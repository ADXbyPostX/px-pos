import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UserAvatar({ name, src, size = "sm", className }: { name: string; src?: string | null; size?: "sm" | "default" | "lg"; className?: string }) {
  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={cn("bg-accent font-medium text-foreground", size === "sm" && "text-[10px]")}>{initials(name) || "PX"}</AvatarFallback>
    </Avatar>
  );
}

export function UserChip({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <UserAvatar name={name} />
      <span className="truncate text-sm">{name}</span>
    </span>
  );
}
