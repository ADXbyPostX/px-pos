"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { Eye, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePrincipal } from "@/components/providers/principal-provider";
import { navFor, trailFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { HEADER_ACTIONS_ID } from "./header-actions";

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function SiteHeader() {
  const pathname = usePathname();
  const params = useParams<{ cid?: string }>();
  const { effective, persona, setPersona } = usePrincipal();
  const groups = navFor(effective?.role ?? "admin", params.cid ?? null);
  const trail = trailFor(groups, pathname);
  const online = useOnline();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="relative z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2 md:px-6 md:py-0">
      <SidebarTrigger className="-ml-1.5" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {trail ? (
            trail.child && trail.child.label !== trail.item.label ? (
              <>
                <BreadcrumbItem className="hidden sm:block">
                  <BreadcrumbLink asChild>
                    <Link href={trail.item.href}>{trail.item.label}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate">{trail.child.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage className="truncate">{trail.item.label}</BreadcrumbPage>
              </BreadcrumbItem>
            )
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
      <div
        id={HEADER_ACTIONS_ID}
        className="scrollbar-none order-last flex basis-full flex-wrap items-center gap-2 pb-3 empty:hidden md:order-none md:min-w-0 md:flex-1 md:basis-0 md:flex-nowrap md:justify-end md:overflow-x-auto md:pb-0 md:empty:flex"
      />
      <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
        {persona ? (
          <Button variant="outline" size="sm" onClick={() => setPersona(null)} className="border-warning/40 text-warning hover:text-warning" aria-label={`Previewing as ${persona.name}. Stop preview`}>
            <Eye data-icon="inline-start" aria-hidden />
            <span className="max-w-32 truncate">{persona.name}</span>
            <X aria-hidden />
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex size-8 items-center justify-center" aria-label={online ? "Online" : "Offline, changes will sync later"} role="status">
              <span className={cn("size-2 rounded-full", online ? "bg-success" : "bg-warning")} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{online ? "Online" : "Offline — changes will sync when you reconnect"}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} className="hidden gap-2 text-muted-foreground lg:inline-flex" aria-label="Search pages and clients">
          <Search aria-hidden />
          <Kbd>⌘K</Kbd>
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setPaletteOpen(true)} className="lg:hidden" aria-label="Search pages and clients">
          <Search aria-hidden />
        </Button>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={groups} />
    </header>
  );
}
