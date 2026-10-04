import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Staff } from "@px-pos/core";
import type { WithId } from "@/hooks/use-live";
import { useData } from "./data";

interface OperatorCtx {
  operator: WithId<Staff> | null;
  signIn: (s: WithId<Staff>) => void;
  lock: () => void;
  /** Call on any interaction to keep the session alive. */
  touch: () => void;
}

const Ctx = createContext<OperatorCtx | null>(null);
const IDLE_MS = 5 * 60_000;

export function useOperator(): OperatorCtx {
  const v = use(Ctx);
  if (!v) throw new Error("useOperator outside OperatorProvider");
  return v;
}

/** Who is working the terminal (picked on the lock screen). Idle or backgrounding locks it. */
export function OperatorProvider({ children }: { children: ReactNode }) {
  const { staff } = useData();
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const last = useRef(0);
  // `staff` holds active members only, so a deactivated operator resolves to null (→ lock screen).
  const operator = staff.find((s) => s.id === operatorId) ?? null;

  const lock = useCallback(() => setOperatorId(null), []);
  const signIn = useCallback((s: WithId<Staff>) => {
    last.current = Date.now();
    setOperatorId(s.id);
  }, []);
  const touch = useCallback(() => {
    last.current = Date.now();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (operatorId && Date.now() - last.current > IDLE_MS) setOperatorId(null);
    }, 15_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" && operatorId && Date.now() - last.current > 60_000) setOperatorId(null);
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [operatorId]);

  const value = useMemo(() => ({ operator, signIn, lock, touch }), [operator, signIn, lock, touch]);
  return <Ctx value={value}>{children}</Ctx>;
}
