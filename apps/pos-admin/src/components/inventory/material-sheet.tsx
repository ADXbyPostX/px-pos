"use client";

import type { ReactNode } from "react";
import { addDays, bizDateLabel, costOfMicro, formatStock, materialLevel, materialStats, MATERIAL_UNIT_LABEL, packOf, priceHistory, rateInMaterialUnit, stockUnitOf, type Material, type MaterialLevel, type PricePoint } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KV, Panel } from "@/components/shared/panel";
import { RecordSheet } from "@/components/shared/record-sheet";
import { Pill } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { rs } from "@/components/vendors/vendor-status";
import { useMaterialBills } from "@/hooks/use-vendors";
import { cn } from "@/lib/utils";
import { useInventoryActions } from "./context";

/** In stock / Low / Out / Below zero (book stock went past what was there: count it). */
export function LevelPill({ level }: { level: MaterialLevel }) {
  if (level === "negative") return <Pill tone="red" label="Below zero" />;
  if (level === "out") return <Pill tone="red" label="Out" />;
  if (level === "low") return <Pill tone="yellow" label="Low" />;
  return <Pill tone="green" label="In stock" />;
}

/** What `micro` of a material is worth at the last price paid (null when never bought). */
export function stockValue(micro: number, m: Pick<Material, "unit" | "pack">, last: PricePoint | undefined): number | null {
  if (!last) return null;
  const rate = rateInMaterialUnit(last.ratePaise, last.unit, m);
  return rate == null ? null : costOfMicro(micro, rate, m);
}

function Strip({ items }: { items: { label: string; value: ReactNode; accent?: boolean }[] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-clip rounded-xl border bg-border">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2.5">
          <span className="truncate text-xs text-muted-foreground">{it.label}</span>
          <span className={cn("truncate text-base font-semibold tabular-nums", it.accent && "text-brand")}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/** One raw material: stock, where it goes, the last two weeks and what it costs. */
export function MaterialSheet() {
  const { cid } = useClient();
  const a = useInventoryActions();
  const id = a.sheet;
  const m = id ? a.materials.byId.get(id) : undefined;
  const bills = useMaterialBills(cid, id);
  const history = id ? priceHistory(bills.data, id).slice(0, 6) : [];
  const onHand = id ? (a.inventory.onHand[id] ?? 0) : 0;
  const level = materialLevel(onHand, m?.lowAt);
  const value = m ? stockValue(Math.max(onHand, 0), m, a.rates.get(m.id)) : null;
  const used = id ? (a.usedIn.get(id) ?? []) : [];
  const days = id
    ? Array.from({ length: 14 }, (_, k) => addDays(a.today, -k))
        .map((d) => ({ d, s: materialStats(a.days.data.find((x) => x.id === d)?.mat?.[id]) }))
        .filter((r) => r.s.in || r.s.used || r.s.rev || r.s.waste || r.s.adj)
    : [];
  const pack = m ? packOf(m) : null;

  return (
    <RecordSheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && a.closeSheet()}
      title={m?.name ?? "Material"}
      meta={m ? <span className="flex items-center gap-2"><LevelPill level={level} />{!m.active ? <span>· switched off</span> : null}</span> : null}
      footer={
        m ? (
          <>
            <Button variant="ghost" onClick={() => a.editMaterial(m)}>
              Edit
            </Button>
            <Button variant="outline" onClick={() => a.count([m.id])}>
              Count
            </Button>
            <Button variant="outline" onClick={() => a.move("waste", m.id)}>
              Wastage
            </Button>
            <Button onClick={() => a.move("in", m.id)}>Stock in</Button>
          </>
        ) : null
      }
    >
      {!m ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <div className="flex flex-col gap-5">
          <Strip
            items={[
              { label: "On hand", value: formatStock(onHand, m), accent: level !== "ok" },
              { label: "Low at", value: m.lowAt ? formatStock(m.lowAt, m) : "—" },
              { label: "Worth", value: value == null ? "—" : rs(value) },
            ]}
          />
          <KV
            items={[
              { label: "Bought in", value: MATERIAL_UNIT_LABEL[m.unit] },
              { label: "Counted in", value: pack ? `pieces (${pack} in one ${MATERIAL_UNIT_LABEL[m.unit]})` : MATERIAL_UNIT_LABEL[stockUnitOf(m)] },
              ...(a.rates.get(m.id) ? [{ label: "Last price", value: `${rs(a.rates.get(m.id)!.ratePaise)}/${MATERIAL_UNIT_LABEL[a.rates.get(m.id)!.unit]} · ${bizDateLabel(a.rates.get(m.id)!.billDate)}` }] : []),
            ]}
          />
          <Panel title="Used in" bodyClassName="p-0">
            {used.length ? (
              <ul className="divide-y">
                {used.map((u) => (
                  <li key={`${u.itemId}${u.size ?? ""}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {u.itemName}
                      {u.size ? <span className="text-muted-foreground"> · {u.size}</span> : null}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{formatStock(u.qtyMicro, m)} each</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">No item&apos;s formula uses it.</p>
            )}
          </Panel>
          <Panel title="Last 14 days" bodyClassName="p-0">
            {a.days.status === "loading" ? (
              <Skeleton className="m-4 h-16" />
            ) : days.length ? (
              <table className="w-full text-sm">
                <caption className="sr-only">Movements in the last 14 days</caption>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Day</th>
                    <th className="px-2 py-2 text-right font-medium">In</th>
                    <th className="px-2 py-2 text-right font-medium">Used</th>
                    <th className="px-2 py-2 text-right font-medium">Wasted</th>
                    <th className="px-4 py-2 text-right font-medium">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {days.map(({ d, s }) => (
                    <tr key={d}>
                      <td className="px-4 py-2 whitespace-nowrap">{bizDateLabel(d)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{s.in ? formatStock(s.in, m) : "—"}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{s.used - s.rev ? formatStock(s.used - s.rev, m) : "—"}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{s.waste ? formatStock(s.waste, m) : "—"}</td>
                      <td className={cn("px-4 py-2 text-right whitespace-nowrap tabular-nums", s.adj < 0 && "text-brand")}>{s.adj ? `${s.adj > 0 ? "+" : "−"}${formatStock(Math.abs(s.adj), m)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing moved.</p>
            )}
          </Panel>
          <Panel title="Prices paid" bodyClassName="p-0">
            {bills.status === "loading" ? (
              <Skeleton className="m-4 h-16" />
            ) : history.length ? (
              <ul className="divide-y">
                {history.map((h) => (
                  <li key={`${h.purchaseId}${h.qtyMilli}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {h.vendorName} <span className="text-muted-foreground">· {bizDateLabel(h.billDate)}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {rs(h.ratePaise)}/{MATERIAL_UNIT_LABEL[h.unit]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">Not bought yet.</p>
            )}
          </Panel>
        </div>
      )}
    </RecordSheet>
  );
}
