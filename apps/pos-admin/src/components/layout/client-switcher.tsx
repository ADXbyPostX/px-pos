"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useClients } from "@/hooks/use-clients";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Which client (outlet) the panel is showing. ⌘J opens it. Keeps the current section when switching. */
export function ClientSwitcher() {
  const [open, setOpen] = useState(false);
  const clients = useClients();
  const { isSuper } = usePrincipal();
  const params = useParams<{ cid?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const current = clients.data.find((c) => c.id === params.cid);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(cid: string) {
    const rest = params.cid ? pathname.replace(/^\/c\/[^/]+/, "") : "";
    setOpen(false);
    setOpenMobile(false);
    router.push(`/c/${cid}${rest}`);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={current?.name ?? "Choose a client"} className="data-[state=open]:bg-sidebar-accent" aria-label={current ? `Client: ${current.name}. Switch client` : "Choose a client"}>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold", current ? "border-brand/40 bg-brand/10 text-brand" : "text-muted-foreground")}>
                {current ? initials(current.name) : <Store className="size-4" aria-hidden />}
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{current?.name ?? "Choose a client"}</span>
                <span className="truncate text-xs text-muted-foreground">{current ? current.city : `${clients.data.length} client${clients.data.length === 1 ? "" : "s"}`}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" aria-hidden />
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Find a client…" />
              <CommandList>
                <CommandEmpty>{clients.status === "loading" ? "Loading…" : "No clients found."}</CommandEmpty>
                <CommandGroup heading="Clients">
                  {clients.data.map((c) => (
                    <CommandItem key={c.id} value={`${c.name} ${c.city} ${c.id}`} onSelect={() => go(c.id)} className="gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold">{initials(c.name)}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{c.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{c.city}{c.status === "suspended" ? " · Suspended" : ""}</span>
                      </span>
                      {c.id === params.cid ? <Check className="size-4 text-brand" aria-hidden /> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {isSuper ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => {
                          setOpen(false);
                          setOpenMobile(false);
                          router.push("/clients?new=1");
                        }}
                      >
                        <Plus aria-hidden />
                        Add client
                      </CommandItem>
                    </CommandGroup>
                  </>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
