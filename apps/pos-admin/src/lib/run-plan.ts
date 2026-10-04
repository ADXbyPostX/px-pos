"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { WritePlan } from "@px-pos/core";
import { applyPlan, firestoreMessage } from "@/lib/firebase/apply-plan";

/**
 * Apply a WritePlan with consistent feedback: success toast, friendly error toast.
 * Returns true when the server accepted the batch.
 */
export function useRunPlan() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (plan: WritePlan | WritePlan[], success?: string): Promise<boolean> => {
    const plans = Array.isArray(plan) ? plan : [plan];
    setPending(true);
    try {
      for (const p of plans) await applyPlan(p);
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(firestoreMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  return { run, pending };
}
