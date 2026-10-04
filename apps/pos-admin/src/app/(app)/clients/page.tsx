import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/shared/loadable";
import { ClientsView } from "./clients-view";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClientsView />
    </Suspense>
  );
}
