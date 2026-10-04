"use client";

import { useEffect, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ErrorPanel } from "@/components/shared/loadable";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useAuth } from "@/components/providers/firebase-provider";
import { brand } from "@/lib/brand";
import { AppSidebar } from "./app-sidebar";
import { SiteHeader } from "./site-header";

function Splash() {
  return (
    <div className="flex flex-1 items-center justify-center" aria-busy aria-label="Loading PX POS">
      <Image src={brand.mark.src} alt="" width={brand.mark.width} height={brand.mark.height} priority unoptimized className="size-14 animate-pulse" />
    </div>
  );
}

/**
 * px-ops shell: sidebar + inset with a sticky header; only the content pane scrolls
 * (the page never does). Browsers without platform access are sent to /setup.
 */
export function AppShell({ defaultOpen, children }: { defaultOpen: boolean; children: ReactNode }) {
  const { status } = usePrincipal();
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "none" || auth.status === "unconfigured") router.replace("/setup");
  }, [status, auth.status, router]);

  if (status === "error") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorPanel error={auth.error ?? "Couldn't load your access. Check your connection."} onRetry={() => window.location.reload()} className="w-full max-w-lg" />
      </div>
    );
  }
  if (status !== "ready") return <Splash />;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset className="isolate h-svh min-w-0 overflow-hidden">
        <div aria-hidden className="bg-ember" />
        <SiteHeader />
        <div id="content" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
