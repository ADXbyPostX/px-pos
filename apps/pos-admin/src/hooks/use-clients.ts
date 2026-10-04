"use client";

import { useMemo } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import { paths, type Client } from "@px-pos/core";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useCollection } from "@/lib/firebase/hooks";

/**
 * Clients the viewer may see: every client for the super admin; for an admin, those whose
 * adminUids contains them (the rules only allow that query shape). While the super admin
 * previews an admin, the list is narrowed client-side to what that admin would see.
 */
export function useClients() {
  const { principal, effective, persona } = usePrincipal();
  const isSuperReal = principal?.role === "superadmin";
  const key = principal ? (isSuperReal ? "clients:all" : `clients:admin:${principal.id}`) : null;
  const live = useCollection<Client>(key, (db) =>
    isSuperReal
      ? query(collection(db, paths.clients()), orderBy("name"))
      : query(collection(db, paths.clients()), where("adminUids", "array-contains", principal?.id ?? "-"), orderBy("name")),
  );
  const data = useMemo(() => (persona && effective ? live.data.filter((c) => c.adminUids.includes(effective.id)) : live.data), [live.data, persona, effective]);
  return { ...live, data };
}
