import { cashMovePlan, type BizDate, type Staff } from "@px-pos/core";
import type { WithId } from "@/hooks/use-live";
import { allocateAndJournal } from "@/local/db";
import { submit } from "@/local/sync";
import { newId, planCtx } from "./context";

/** Opening the drawer without a sale is recorded (who, when, why) — never silent. */
export function recordNoSale(session: { cid: string; tid: string }, operator: WithId<Staff> | null, bizDate: BizDate, reason: string): void {
  const id = newId();
  const { row } = allocateAndJournal(`nosale:${id}`, [], () => ({
    plan: cashMovePlan(planCtx(session, operator), { id, businessDate: bizDate, kind: "no_sale", amountPaise: 0, reason }),
    result: null,
  }));
  submit(row);
}
