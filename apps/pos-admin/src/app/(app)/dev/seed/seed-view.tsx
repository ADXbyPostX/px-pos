"use client";

import { useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, query } from "firebase/firestore";
import { CheckCircle2, FlaskConical, Loader2 } from "lucide-react";
import { businessDateFor, addDays, paths, type Client, type Item } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/shared/empty";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { usePrincipal } from "@/components/providers/principal-provider";
import { applyPlan, firestoreMessage } from "@/lib/firebase/apply-plan";
import { getDb } from "@/lib/firebase/client";
import { useDoc } from "@/lib/firebase/hooks";
import { DEMO_CID, DEMO_NAME, demoHistoryPlans, demoSeedPlans } from "@/lib/demo-seed";
import { newId } from "@/lib/ids";

export function SeedView() {
  const { isSuper, planCtx } = usePrincipal();
  const demo = useDoc<Client>(paths.client(DEMO_CID));
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<"seed" | "history" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const append = (s: string) => setLog((l) => [...l, s]);

  if (!isSuper) return <Empty icon={FlaskConical} label="Only the super admin can create demo data." className="flex-1" />;

  async function seed() {
    setBusy("seed");
    setError(null);
    setLog([]);
    try {
      const exists = await getDoc(doc(getDb(), paths.client(DEMO_CID)));
      if (exists.exists()) throw new Error(`${DEMO_NAME} already exists.`);
      const today = businessDateFor(Date.now(), 180);
      const { plans } = demoSeedPlans(planCtx, () => newId(), today);
      for (const [i, p] of plans.entries()) {
        await applyPlan(p);
        append(`Batch ${i + 1}/${plans.length}: ${p.ops.length} writes`);
      }
      append(`${DEMO_NAME} is ready.`);
    } catch (e) {
      setError(firestoreMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function history() {
    if (!demo.data) return;
    setBusy("history");
    setError(null);
    setLog([]);
    try {
      const db = getDb();
      const today = businessDateFor(Date.now(), demo.data.day.cutoffMin);
      const yesterday = await getDoc(doc(db, paths.dailyStats(DEMO_CID, addDays(today, -1))));
      if (yesterday.exists()) throw new Error("History already generated.");
      const [itemsSnap, staffSnap] = await Promise.all([getDocs(query(collection(db, paths.col(DEMO_CID, "items")))), getDocs(query(collection(db, paths.col(DEMO_CID, "staff"))))]);
      const items = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Item) })).filter((i) => i.active);
      const plans = demoHistoryPlans(planCtx(DEMO_CID), demo.data, items, staffSnap.docs.map((d) => d.id), today, 30);
      for (const [i, p] of plans.entries()) {
        await applyPlan(p);
        if (i % 5 === 4 || i === plans.length - 1) append(`${i + 1}/${plans.length} days written`);
      }
      append("30 closed days of sales, expenses and Z reports added.");
    } catch (e) {
      setError(firestoreMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Demo data" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Demo outlet" bodyClassName="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">{DEMO_NAME} (Mumbai), a tea shop: 50 items across chai, teas, coffee, coolers, sandwiches, snacks and bakery, each with its own GST rate and regular/large sizes. Bakery and packaged stock is tracked. 12 tables (Inside + Verandah), 5 staff and a Demo Admin assigned to it. All three order modes are on.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={seed} disabled={Boolean(busy) || demo.status === "loading" || Boolean(demo.data)}>
              {busy === "seed" ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
              {demo.data ? `${DEMO_NAME} exists` : `Create ${DEMO_NAME}`}
            </Button>
            {demo.data ? (
              <Button variant="outline" asChild>
                <Link href={`/c/${DEMO_CID}/menu`}>Open its menu</Link>
              </Button>
            ) : null}
          </div>
        </Panel>
        <Panel title="Sales history" bodyClassName="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">30 closed business days ending yesterday: daily sales, payments, tax, expenses and Z reports, so the summary and reports have something to show.</p>
          <Button className="self-start" onClick={history} disabled={Boolean(busy) || !demo.data}>
            {busy === "history" ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Generate 30 days
          </Button>
        </Panel>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {log.length ? (
        <Panel title="Progress">
          <ul className="flex flex-col gap-1 p-4 font-mono text-xs">
            {log.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
