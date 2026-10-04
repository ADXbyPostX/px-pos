"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useClients } from "@/hooks/use-clients";
import { flatNav, type NavGroup } from "@/lib/nav";

/** ⌘K: jump to any page of the current client, or switch client. */
export function CommandPalette({ open, onOpenChange, groups }: { open: boolean; onOpenChange: (o: boolean) => void; groups: NavGroup[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ cid?: string }>();
  const clients = useClients();
  const pages = flatNav(groups);
  const byGroup = pages.reduce<Record<string, typeof pages>>((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Go to" description="Jump to a page or client">
      <Command>
        <CommandInput placeholder="Type a page or client…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          {Object.entries(byGroup).map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((p) => (
                <CommandItem key={p.href} value={`${group} ${p.label}`} onSelect={() => go(p.href)}>
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {clients.data.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Clients">
                {clients.data.map((c) => (
                  <CommandItem key={c.id} value={`client ${c.name} ${c.city}`} onSelect={() => go(`/c/${c.id}${params.cid ? pathname.replace(/^\/c\/[^/]+/, "") : ""}`)}>
                    <Store aria-hidden />
                    {c.name}
                    <span className="ml-auto text-xs text-muted-foreground">{c.city}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
