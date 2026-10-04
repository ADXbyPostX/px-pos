"use client";

import { createContext, use, useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { paths, type PlanCtx, type PlatformUser } from "@px-pos/core";
import { useDoc, type WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { devToolsEnabled } from "@/lib/nav";
import { useAuth } from "./firebase-provider";

export type Principal = WithId<PlatformUser>;

interface PrincipalCtx {
  status: "loading" | "ready" | "none" | "error";
  /** The signed-in platform user (null = this browser has no access yet). */
  principal: Principal | null;
  /** Who the UI is rendered for: the principal, or the admin being previewed (dev only). */
  effective: Principal | null;
  persona: Principal | null;
  setPersona: (uid: string | null) => void;
  isSuper: boolean;
  /** Build the context every WritePlan needs (actor = the real principal, never the persona). */
  planCtx: (cid: string) => PlanCtx;
}

const Ctx = createContext<PrincipalCtx | null>(null);
const PERSONA_KEY = "pos_persona";

const noop = () => () => {};
/** The persona remembered in this browser (dev only; null on the server / when storage is blocked). */
function readStoredPersona(): string | null {
  if (!devToolsEnabled) return null;
  try {
    return localStorage.getItem(PERSONA_KEY);
  } catch {
    return null; /* storage blocked */
  }
}

export function usePrincipal(): PrincipalCtx {
  const v = use(Ctx);
  if (!v) throw new Error("usePrincipal must be used inside <PrincipalProvider>");
  return v;
}

export function PrincipalProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const me = useDoc<PlatformUser>(auth.uid ? paths.platformUser(auth.uid) : null);
  const storedPersonaUid = useSyncExternalStore(noop, readStoredPersona, () => null);
  /** undefined = not chosen in this session yet (fall back to the remembered one). */
  const [chosenPersonaUid, setPersonaUid] = useState<string | null | undefined>(undefined);
  const personaUid = chosenPersonaUid === undefined ? storedPersonaUid : chosenPersonaUid;

  const principal = me.data && me.data.active ? me.data : null;
  const isSuper = principal?.role === "superadmin";
  const persona = useDoc<PlatformUser>(devToolsEnabled && isSuper && personaUid && personaUid !== principal?.id ? paths.platformUser(personaUid) : null);

  const setPersona = useCallback((uid: string | null) => {
    setPersonaUid(uid);
    try {
      if (uid) localStorage.setItem(PERSONA_KEY, uid);
      else localStorage.removeItem(PERSONA_KEY);
    } catch {
      /* storage blocked */
    }
  }, []);

  const actorId = principal?.id ?? auth.uid ?? "unknown";
  const actorName = principal?.name;
  const planCtx = useCallback(
    (cid: string): PlanCtx => ({
      cid,
      nowMs: Date.now(),
      actorId,
      ...(actorName ? { actorName } : {}),
      actorKind: "platform",
      source: "admin",
      newId,
    }),
    [actorId, actorName],
  );

  const value = useMemo<PrincipalCtx>(() => {
    const status: PrincipalCtx["status"] =
      auth.status === "error" || me.status === "error" ? "error" : auth.status !== "ready" || me.status === "loading" ? "loading" : principal ? "ready" : "none";
    const personaDoc = persona.data && persona.data.role === "admin" ? persona.data : null;
    return {
      status,
      principal,
      effective: personaDoc ?? principal,
      persona: personaDoc,
      setPersona,
      isSuper: isSuper && !personaDoc,
      planCtx,
    };
  }, [auth.status, me.status, principal, persona.data, isSuper, setPersona, planCtx]);

  return <Ctx value={value}>{children}</Ctx>;
}
