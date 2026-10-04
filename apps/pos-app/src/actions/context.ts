import { makeId, type PlanCtx, type Staff } from "@px-pos/core";

type PairedLike = { cid: string; tid: string };

/** Random id for docs created on the terminal (collision-safe enough across terminals). */
export function newId(len = 20): string {
  return makeId(Math.random, len);
}

/** Context every WritePlan needs: actor = the signed-in operator, else the terminal itself. */
export function planCtx(session: PairedLike, operator: Pick<Staff, "name"> & { id: string } | null): PlanCtx {
  return {
    cid: session.cid,
    nowMs: Date.now(),
    actorId: operator?.id ?? `terminal:${session.tid}`,
    ...(operator?.name ? { actorName: operator.name } : {}),
    actorKind: operator ? "staff" : "terminal",
    terminalId: session.tid,
    source: "app",
    newId,
  };
}
