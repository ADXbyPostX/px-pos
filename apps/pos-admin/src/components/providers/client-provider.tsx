"use client";

import { createContext, use, useEffect, type ReactNode } from "react";
import { Building2, ShieldAlert } from "lucide-react";
import { paths, type Client } from "@px-pos/core";
import { Empty } from "@/components/shared/empty";
import { PageSkeleton } from "@/components/shared/loadable";
import { useDoc, type WithId } from "@/lib/firebase/hooks";
import { usePrincipal } from "./principal-provider";

interface ClientCtx {
  cid: string;
  client: WithId<Client>;
}

const Ctx = createContext<ClientCtx | null>(null);
export const LAST_CLIENT_COOKIE = "pos_cid";

export function useClient(): ClientCtx {
  const v = use(Ctx);
  if (!v) throw new Error("useClient must be used inside a /c/[cid] route");
  return v;
}

/** Optional variant for components that render both inside and outside a client. */
export function useMaybeClient(): ClientCtx | null {
  return use(Ctx);
}

/** Live client doc for every /c/[cid] page, plus the access check. */
export function ClientProvider({ cid, children }: { cid: string; children: ReactNode }) {
  const { effective, persona } = usePrincipal();
  const client = useDoc<Client>(paths.client(cid));

  useEffect(() => {
    document.cookie = `${LAST_CLIENT_COOKIE}=${encodeURIComponent(cid)}; path=/; max-age=31536000; samesite=lax`;
  }, [cid]);

  if (client.status === "loading") return <PageSkeleton />;
  if (client.status === "error" || !client.data) {
    return <Empty icon={ShieldAlert} label={client.status === "error" ? "You don't have access to this client." : "This client doesn't exist."} className="flex-1" />;
  }
  if (persona && effective && !client.data.adminUids.includes(effective.id)) {
    return <Empty icon={Building2} label={`${effective.name} isn't assigned to ${client.data.name}.`} className="flex-1" />;
  }
  return <Ctx value={{ cid, client: client.data }}>{children}</Ctx>;
}
