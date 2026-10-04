"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  computeBill,
  del,
  fyFor,
  GST_STATES,
  rateLabel,
  receiptText,
  renderInvoice,
  seriesFor,
  stateName,
  TAX_RATES,
  updateClientPlan,
  upiPayUri,
  validateClient,
  validateVpa,
  type ApprovalKey,
  type Client,
  type InvoicePrint,
  type Rounding,
  type TaxMode,
} from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldRow } from "@/components/shared/field";
import { FormError, IntInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QrCode } from "@/components/shared/qr-code";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useRunPlan } from "@/lib/run-plan";

type Draft = Client;

const APPROVALS: Array<{ key: ApprovalKey; label: string }> = [
  { key: "voidAfterKot", label: "Voiding an item already sent to the kitchen" },
  { key: "discountOverCap", label: "Discounts above the staff member's limit" },
  { key: "comp", label: "Complimentary (free) items or bills" },
  { key: "editBill", label: "Editing a printed bill" },
  { key: "cancelBill", label: "Cancelling a bill" },
  { key: "reprint", label: "Reprinting a bill" },
  { key: "paidOut", label: "Paying expenses from the cash drawer" },
  { key: "stockAdjust", label: "Stock adjustments and wastage" },
  { key: "dayClose", label: "Closing the day (Z report)" },
];

const CUTOFFS = [0, 60, 120, 180, 240, 300, 360].map((m) => ({ value: String(m), label: m === 0 ? "Midnight (00:00)" : `${String(m / 60).padStart(2, "0")}:00` }));

/** Keys that differ between the stored client and the draft. */
function diffKeys(a: Client, b: Client): Array<keyof Client> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Client>;
  return [...keys].filter((k) => !["updatedAtMs", "createdAt", "createdAtMs", "id", "_path"].includes(k as string) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function samplePrint(d: Draft): InvoicePrint {
  const lines = [
    { lineId: "a", name: "Paneer Tikka", variantName: "Full", qty: 1, unitPricePaise: 26000, taxBps: null },
    { lineId: "b", name: "Butter Naan", qty: 2, unitPricePaise: 6000, taxBps: null },
  ];
  const bill = computeBill({
    lines: lines.map((l) => ({ lineId: l.lineId, unitPricePaise: l.unitPricePaise, qty: l.qty, voidedQty: 0, taxBps: l.taxBps })),
    serviceChargeOptIn: false,
    charges: d.charges,
    mode: "dineIn",
    client: { taxMode: d.taxMode, rounding: d.rounding, defaultTaxBps: d.defaultTaxBps },
  });
  const now = Date.now();
  return {
    invoiceNo: `${seriesFor(d.invoicePrefix || "", "1")}/${fyFor(now)}/000001`,
    issuedAtMs: now,
    orderNo: "1-001",
    mode: "dineIn",
    where: "T4",
    covers: 2,
    docType: bill.docType,
    supplier: { legalName: d.legalName, gstin: d.gstin, fssai: d.fssai, address: d.address, stateName: d.stateName, stateCode: d.stateCode, phone: d.phone },
    lines: lines.map((l) => ({ lineId: l.lineId, name: l.name, variantName: l.variantName, qty: l.qty, unitPricePaise: l.unitPricePaise, amountPaise: l.unitPricePaise * l.qty, taxBps: bill.lines.find((b) => b.lineId === l.lineId)?.taxBps ?? 0 })),
    bill,
    payments: [{ mode: "upi", amountPaise: bill.grandTotalPaise }],
    staffName: "Ravi",
  };
}

export function SettingsView() {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [d, setD] = useState<Draft>(client);
  const [error, setError] = useState<string | null>(null);
  const [cols, setCols] = useState<"32" | "48">("48");
  const changed = useMemo(() => diffKeys(client, d), [client, d]);
  const dirty = changed.length > 0;

  // Pick up remote changes to fields the user hasn't touched — adjusted during render.
  const [seenClient, setSeenClient] = useState(client);
  if (client !== seenClient) {
    setSeenClient(client);
    setD((cur) => {
      const next = { ...client };
      for (const k of diffKeys(client, cur)) (next as Record<string, unknown>)[k] = cur[k];
      return next;
    });
  }
  // Financial year for the numbering example (fixed for the life of the page).
  const [fy] = useState(() => fyFor(Date.now()));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const preview = useMemo(() => receiptText(renderInvoice(samplePrint(d), d.receipt, { copy: "ORIGINAL", cols: Number(cols) as 32 | 48 }), Number(cols) as 32 | 48), [d, cols]);

  async function save() {
    const err = validateClient(d);
    if (err) return setError(err);
    setError(null);
    const patch: Partial<Client> = {};
    // A cleared optional field (e.g. GSTIN) must be deleted, not skipped.
    for (const k of changed) (patch as Record<string, unknown>)[k] = d[k] === undefined || d[k] === "" ? del() : d[k];
    await run(updateClientPlan(planCtx(cid), client, patch, "client.settings"), "Settings saved");
  }

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <>
            {dirty ? <span className="text-xs text-warning tabular-nums">{changed.length} unsaved change{changed.length === 1 ? "" : "s"}</span> : null}
            <Button variant="ghost" size="sm" disabled={!dirty || pending} onClick={() => { setD(client); setError(null); }}>
              Discard
            </Button>
            <Button size="sm" disabled={!dirty || pending} onClick={save}>
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
              Save changes
            </Button>
          </>
        }
      />
      <FormError error={error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Business" bodyClassName="flex flex-col gap-4 p-4">
          <FieldRow>
            <Field label="Outlet name" htmlFor="st-name">
              <Input id="st-name" value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Legal name (on bills)" htmlFor="st-legal">
              <Input id="st-legal" value={d.legalName} onChange={(e) => set("legalName", e.target.value)} maxLength={100} />
            </Field>
          </FieldRow>
          <Field label="Address" htmlFor="st-address">
            <Textarea id="st-address" value={d.address} onChange={(e) => set("address", e.target.value)} rows={2} maxLength={200} />
          </Field>
          <FieldRow>
            <Field label="City" htmlFor="st-city">
              <Input id="st-city" value={d.city} onChange={(e) => set("city", e.target.value)} maxLength={40} />
            </Field>
            <Field label="State" htmlFor="st-state">
              <SelectField id="st-state" value={d.stateCode} onValueChange={(v) => setD((s) => ({ ...s, stateCode: v, stateName: stateName(v) ?? s.stateName }))} options={GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Phone" htmlFor="st-phone">
              <Input id="st-phone" value={d.phone ?? ""} onChange={(e) => set("phone", e.target.value)} inputMode="tel" maxLength={15} />
            </Field>
            <Field label="FSSAI licence no." htmlFor="st-fssai">
              <Input id="st-fssai" value={d.fssai} onChange={(e) => set("fssai", e.target.value.replace(/\s/g, ""))} inputMode="numeric" maxLength={14} className="font-mono" />
            </Field>
          </FieldRow>
        </Panel>

        <Panel title="Tax" bodyClassName="flex flex-col gap-4 p-4">
          <FieldRow>
            <Field label="GST registration" htmlFor="st-taxmode">
              <SelectField
                id="st-taxmode"
                value={d.taxMode}
                onValueChange={(v: TaxMode) => set("taxMode", v)}
                options={[
                  { value: "regular", label: "Regular (tax invoice)" },
                  { value: "composition", label: "Composition (bill of supply)" },
                  { value: "unregistered", label: "Not registered" },
                ]}
              />
            </Field>
            <Field label="GSTIN" htmlFor="st-gstin">
              <Input id="st-gstin" value={d.gstin ?? ""} onChange={(e) => set("gstin", e.target.value.toUpperCase() || undefined)} maxLength={15} className="font-mono uppercase" />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Default GST rate" htmlFor="st-rate">
              <SelectField id="st-rate" value={String(d.defaultTaxBps)} onValueChange={(v) => set("defaultTaxBps", Number(v))} options={TAX_RATES.map((r) => ({ value: String(r), label: rateLabel(r) }))} disabled={d.taxMode !== "regular"} />
            </Field>
            <Field label="Round bill total">
              <ToggleGroup type="single" variant="outline" value={d.rounding} onValueChange={(v) => v && set("rounding", v as Rounding)} className="w-full" aria-label="Rounding">
                <ToggleGroupItem value="rupee" className="flex-1">Nearest rupee</ToggleGroupItem>
                <ToggleGroupItem value="none" className="flex-1">Keep paise</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </FieldRow>
        </Panel>

        <Panel title="Payments" bodyClassName="flex flex-col gap-4 p-4">
          <FieldRow>
            <Field label="UPI ID (UPI payments go here)" htmlFor="st-vpa">
              <Input
                id="st-vpa"
                value={d.upi?.vpa ?? ""}
                onChange={(e) => {
                  const vpa = e.target.value.replace(/\s/g, "");
                  set("upi", vpa ? { vpa, payee: d.upi?.payee ?? d.name.split(",")[0]!.trim() } : undefined);
                }}
                placeholder="tearoom@okicici"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Field label="Name shown to payers" htmlFor="st-payee">
              <Input id="st-payee" value={d.upi?.payee ?? ""} onChange={(e) => d.upi && set("upi", { ...d.upi, payee: e.target.value })} maxLength={50} disabled={!d.upi} />
            </Field>
          </FieldRow>
          {d.upi && !validateVpa(d.upi.vpa) ? (
            <div className="flex items-center gap-4">
              <QrCode value={upiPayUri(d.upi, 100)} label={`Test UPI QR for ₹1 to ${d.upi.vpa}`} className="size-32 shrink-0" />
              <p className="text-sm text-muted-foreground">
                Scan this ₹1 test with your phone before saving: your UPI app should show the outlet&apos;s bank account name. You don&apos;t have to pay it. The till shows the same QR with each bill&apos;s amount; card and other payments are recorded as they are.
              </p>
            </div>
          ) : null}
        </Panel>

        <Panel title="Service charge and stock" bodyClassName="flex flex-col gap-2 p-4">
          <Field label="Optional service charge % (staff must add it per bill, with the guest's consent)" htmlFor="st-sc">
            <IntInput id="st-sc" value={d.charges.serviceChargeBps / 100} onChange={(n) => set("charges", { ...d.charges, serviceChargeBps: Math.min(20, n ?? 0) * 100 })} min={0} max={20} />
          </Field>
          <SwitchRow label="Mark an item unavailable when its stock runs out" checked={d.stockAutoOff} onCheckedChange={(v) => set("stockAutoOff", v)} />
        </Panel>

        <Panel title="Business day and kitchen" bodyClassName="flex flex-col gap-4 p-4">
          <Field label="Day ends at (sales after midnight count to the previous day)" htmlFor="st-cutoff">
            <SelectField id="st-cutoff" value={String(d.day.cutoffMin)} onValueChange={(v) => set("day", { cutoffMin: Number(v) })} options={CUTOFFS} />
          </Field>
          <FieldRow>
            <Field label="KOT turns yellow after (min)" htmlFor="st-warn">
              <IntInput id="st-warn" value={d.kds.warnMin} onChange={(n) => set("kds", { ...d.kds, warnMin: n ?? 10 })} min={1} max={120} />
            </Field>
            <Field label="KOT turns red after (min)" htmlFor="st-late">
              <IntInput id="st-late" value={d.kds.lateMin} onChange={(n) => set("kds", { ...d.kds, lateMin: n ?? 20 })} min={1} max={240} />
            </Field>
          </FieldRow>
        </Panel>

        <Panel title="Invoice numbering" bodyClassName="flex flex-col gap-4 p-4">
          <Field label="Prefix (0–2 letters)" htmlFor="st-prefix">
            <Input id="st-prefix" value={d.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))} className="font-mono uppercase" />
          </Field>
          <p className="text-sm text-muted-foreground">
            New terminals number bills like <span className="font-mono text-foreground">{seriesFor(d.invoicePrefix || "", "1")}/{fy}/000001</span>. Paired terminals keep their series.
          </p>
        </Panel>

        <Panel title="Discounts and approvals" bodyClassName="flex flex-col gap-1 p-4" className="lg:row-span-2">
          <FieldRow className="pb-3">
            <Field label="Cashier discount limit %" htmlFor="st-cap-cashier">
              <IntInput id="st-cap-cashier" value={d.discountCapBps.cashier / 100} onChange={(n) => set("discountCapBps", { ...d.discountCapBps, cashier: Math.min(100, n ?? 0) * 100 })} min={0} max={100} />
            </Field>
            <Field label="Captain discount limit %" htmlFor="st-cap-captain">
              <IntInput id="st-cap-captain" value={d.discountCapBps.captain / 100} onChange={(n) => set("discountCapBps", { ...d.discountCapBps, captain: Math.min(100, n ?? 0) * 100 })} min={0} max={100} />
            </Field>
          </FieldRow>
          <p className="pb-1 text-xs font-medium text-muted-foreground">Needs a manager on the tablet</p>
          {APPROVALS.map((a) => (
            <SwitchRow key={a.key} label={a.label} checked={d.approvals[a.key]} onCheckedChange={(v) => set("approvals", { ...d.approvals, [a.key]: v })} />
          ))}
        </Panel>

        <Panel
          title="Receipt"
          className="lg:col-span-2 2xl:col-span-2"
          action={
            <ToggleGroup type="single" variant="outline" size="sm" value={cols} onValueChange={(v) => v && setCols(v as "32" | "48")} aria-label="Paper width">
              <ToggleGroupItem value="32" className="px-3">58 mm</ToggleGroupItem>
              <ToggleGroupItem value="48" className="px-3">80 mm</ToggleGroupItem>
            </ToggleGroup>
          }
          bodyClassName="grid grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="flex flex-col gap-4">
            <Field label="Header lines (one per line)" htmlFor="st-header">
              <Textarea id="st-header" value={d.receipt.header.join("\n")} onChange={(e) => set("receipt", { ...d.receipt, header: e.target.value.split("\n").slice(0, 4) })} rows={3} />
            </Field>
            <Field label="Footer lines (one per line)" htmlFor="st-footer">
              <Textarea id="st-footer" value={d.receipt.footer.join("\n")} onChange={(e) => set("receipt", { ...d.receipt, footer: e.target.value.split("\n").slice(0, 4) })} rows={3} />
            </Field>
            <SwitchRow label="Print SAC code 996331" checked={d.receipt.showSac} onCheckedChange={(v) => set("receipt", { ...d.receipt, showSac: v })} />
          </div>
          <pre aria-label="Receipt preview" className="max-h-[32rem] overflow-auto rounded-lg border bg-white px-3 py-3 font-mono text-[11px] leading-snug text-black">
            {preview}
          </pre>
        </Panel>
      </div>
    </>
  );
}
