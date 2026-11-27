import "server-only";

import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { bizDateLabel, correctionText, formatINR, istDateTimeLabel, MODE_LABEL, type Client, type DayCorrection, type ItemSales, type OrderMode, type Paise, type ZReport } from "@px-pos/core";

/*
 * The end-of-day PDFs (A4, on paper): the Z report and the day's item sales. Geist (it has ₹) and
 * the PX POS wordmark ship with the function (next.config.ts › outputFileTracingIncludes).
 */

const ASSETS = path.join(process.cwd(), "src/server/pdf/assets");
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Geist",
    fonts: [
      { src: path.join(ASSETS, "Geist-400.ttf"), fontWeight: 400 },
      { src: path.join(ASSETS, "Geist-600.ttf"), fontWeight: 600 },
      { src: path.join(ASSETS, "Geist-700.ttf"), fontWeight: 700 },
    ],
  });
  // Names and figures never break across lines with a hyphen.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

const INK = "#111111";
const MUTED = "#6b6b6b";
const RULE = "#e3e3e3";
const ZEBRA = "#f6f6f6";
const RED = "#fc0303";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9, color: INK, paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  logo: { width: 84, height: 22.4 },
  kind: { fontSize: 8, fontWeight: 600, letterSpacing: 1.2, color: MUTED, textAlign: "right" },
  number: { fontSize: 20, fontWeight: 700, textAlign: "right" },
  redRule: { height: 2, backgroundColor: RED, marginBottom: 12 },
  outlet: { fontSize: 13, fontWeight: 700 },
  muted: { color: MUTED },
  title: { fontSize: 11, fontWeight: 600, marginTop: 10 },
  badge: { marginTop: 6, alignSelf: "flex-start", borderWidth: 1, borderColor: RED, color: RED, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1.5, fontSize: 7.5, fontWeight: 600, letterSpacing: 0.6 },
  kpis: { flexDirection: "row", gap: 8, marginTop: 16, marginBottom: 6 },
  kpi: { flex: 1, borderWidth: 1, borderColor: RULE, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7.5, color: MUTED, marginBottom: 3 },
  kpiValue: { fontSize: 12.5, fontWeight: 700 },
  cols: { flexDirection: "row", gap: 16 },
  col: { flex: 1 },
  section: { marginTop: 14 },
  h2: { fontSize: 8, fontWeight: 600, letterSpacing: 1, color: MUTED, marginBottom: 5 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, marginBottom: 1 },
  thText: { fontSize: 7.5, fontWeight: 600, color: MUTED },
  tr: { flexDirection: "row", paddingVertical: 3.2, borderBottomWidth: 0.5, borderBottomColor: RULE },
  trZebra: { backgroundColor: ZEBRA },
  total: { flexDirection: "row", paddingVertical: 4, borderTopWidth: 1, borderTopColor: INK, marginTop: -0.5 },
  bold: { fontWeight: 700 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

const rs = (p: Paise) => formatINR(p);
const PAY: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", other: "Other" };
const VENDOR_WAY: Record<string, string> = { drawer: "Till cash", cash: "Other cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other" };

type Align = "left" | "right";
interface Col {
  label: string;
  /** Flex share of the row. */
  w: number;
  align?: Align;
}

/** Same box for a column's heading and its cells, so they line up exactly. */
const colBox = (c: Col) => ({ flexGrow: c.w, flexShrink: 1, flexBasis: 0, textAlign: c.align ?? ("left" as Align), paddingRight: c.align === "right" ? 0 : 6 });

function Table({ cols, rows, total, zebra = false }: { cols: Col[]; rows: string[][]; total?: string[]; zebra?: boolean }) {
  const cell = (c: Col, v: string, i: number, bold = false) => (
    <Text key={i} style={[colBox(c), bold ? s.bold : {}]}>
      {v}
    </Text>
  );
  return (
    <View>
      <View style={s.th}>
        {cols.map((c, i) => (
          <Text key={i} style={[s.thText, colBox(c)]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, k) => (
        <View key={k} style={[s.tr, zebra && k % 2 === 1 ? s.trZebra : {}]} wrap={false}>
          {cols.map((c, i) => cell(c, r[i] ?? "", i))}
        </View>
      ))}
      {total ? <View style={s.total}>{cols.map((c, i) => cell(c, total[i] ?? "", i, true))}</View> : null}
    </View>
  );
}

/** Label / amount pairs; the `strong` rows are drawn as totals. */
function Lines({ rows }: { rows: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }> }) {
  return (
    <View>
      {rows.map((r, k) =>
        r.strong ? (
          <View key={k} style={s.total}>
            <Text style={[{ flex: 1 }, s.bold]}>{r.label}</Text>
            <Text style={s.bold}>{r.value}</Text>
          </View>
        ) : (
          <View key={k} style={s.tr}>
            <Text style={[{ flex: 1 }, r.muted ? s.muted : {}]}>{r.label}</Text>
            <Text style={r.muted ? s.muted : {}}>{r.value}</Text>
          </View>
        ),
      )}
    </View>
  );
}

function Header({ kind, number, client, title, sub, corrected }: { kind: string; number?: string; client: Client; title: string; sub: string; corrected?: boolean }) {
  return (
    <View>
      <View style={s.top}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf drawing on the page, not an HTML <img> */}
        <Image src={path.join(ASSETS, "pxpos-black.png")} style={s.logo} />
        <View>
          <Text style={s.kind}>{kind}</Text>
          {number ? <Text style={s.number}>{number}</Text> : null}
        </View>
      </View>
      <View style={s.redRule} />
      <Text style={s.outlet}>{client.name}</Text>
      <Text style={s.muted}>{[client.address, client.city].filter(Boolean).join(", ")}</Text>
      <Text style={s.muted}>{[client.gstin ? `GSTIN ${client.gstin}` : "", client.fssai ? `FSSAI ${client.fssai}` : ""].filter(Boolean).join("  ·  ")}</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.muted}>{sub}</Text>
      {corrected ? <Text style={s.badge}>CORRECTED AFTER CLOSE</Text> : null}
    </View>
  );
}

function Footer({ madeAtMs }: { madeAtMs: number }) {
  return (
    <View style={s.footer} fixed>
      <Text>PX POS · pxpos.postx.in · made {istDateTimeLabel(madeAtMs)}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function Kpis({ items }: { items: Array<[string, string]> }) {
  return (
    <View style={s.kpis}>
      {items.map(([label, value]) => (
        <View key={label} style={s.kpi}>
          <Text style={s.kpiLabel}>{label}</Text>
          <Text style={s.kpiValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function ZReportPdf({ z, client, terminalNames, corrections, madeAtMs }: { z: ZReport; client: Client; terminalNames: Record<string, string>; corrections: DayCorrection[]; madeAtMs: number }) {
  const changes = corrections.filter((c) => c.kind !== "reopen");
  const pays = Object.entries(z.byPay).filter(([, v]) => v);
  const refunds = Object.entries(z.refundsByPay).filter(([, v]) => v);
  const modes = Object.entries(z.byMode).filter(([, v]) => v.n || v.paise);
  const taxes = Object.entries(z.byTaxBps);
  const other = [
    { label: `Cancelled bills (${z.cancelledBills.n})`, value: rs(z.cancelledBills.paise) },
    { label: `Voided items (${z.voidItems.n})`, value: rs(z.voidItems.paise) },
    { label: "Expenses", value: rs(z.expensesPaise) },
    ...(z.purchasesPaise ? [{ label: `Bought from vendors (${z.purchaseBills ?? 0} bills)`, value: rs(z.purchasesPaise) }] : []),
    ...(z.vendorPaidPaise ? [{ label: "Paid to vendors", value: rs(z.vendorPaidPaise) }, ...Object.entries(z.vendorPaidByMode ?? {}).filter(([, v]) => v).map(([m, v]) => ({ label: `   ${VENDOR_WAY[m] ?? m}`, value: rs(v), muted: true }))] : []),
  ];
  return (
    <Document title={`Z report ${z.zNo} · ${client.name} · ${z.businessDate}`} author="PX POS" creator="PX POS">
      <Page size="A4" style={s.page}>
        <Header kind="Z REPORT" number={`#${z.zNo}`} client={client} title={`Business day ${bizDateLabel(z.businessDate, true)}`} sub={`Closed ${istDateTimeLabel(z.closedAtMs)}`} corrected={changes.length > 0} />
        <Kpis
          items={[
            ["Total billed", rs(z.totalPaise)],
            ["Orders", String(z.orders)],
            ["Average order", z.orders ? rs(Math.round(z.totalPaise / z.orders)) : "—"],
            ["Net sales (excl. GST)", rs(z.netPaise)],
          ]}
        />
        <View style={s.cols}>
          <View style={[s.col, s.section]}>
            <Text style={s.h2}>SALES</Text>
            <Lines
              rows={[
                { label: "Gross", value: rs(z.grossPaise) },
                { label: "Discounts", value: rs(-z.discountsPaise) },
                ...(z.compPaise ? [{ label: "   of which complimentary", value: rs(-z.compPaise), muted: true }] : []),
                { label: "Net sales", value: rs(z.netPaise) },
                ...(z.chargesPaise ? [{ label: "Charges", value: rs(z.chargesPaise) }] : []),
                { label: "CGST", value: rs(z.cgstPaise) },
                { label: "SGST", value: rs(z.sgstPaise) },
                { label: "Round off", value: rs(z.roundOffPaise) },
                { label: "Total billed", value: rs(z.totalPaise), strong: true },
                ...(z.tipsPaise ? [{ label: "Tips (outside the bill)", value: rs(z.tipsPaise), muted: true }] : []),
              ]}
            />
          </View>
          <View style={[s.col, s.section]}>
            <Text style={s.h2}>PAYMENTS</Text>
            <Lines rows={[...pays.map(([m, v]) => ({ label: PAY[m] ?? m, value: rs(v) })), ...refunds.map(([m, v]) => ({ label: `Refund, ${PAY[m] ?? m}`, value: rs(-v) }))]} />
            <View style={s.section}>
              <Text style={s.h2}>ORDER TYPES</Text>
              <Lines rows={modes.map(([m, v]) => ({ label: `${MODE_LABEL[m as OrderMode] ?? m} (${v.n})`, value: rs(v.paise) }))} />
            </View>
          </View>
        </View>
        {taxes.length ? (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>GST BY RATE</Text>
            <Table
              cols={[
                { label: "Rate", w: 1 },
                { label: "Taxable value", w: 2, align: "right" },
                { label: "CGST", w: 1.5, align: "right" },
                { label: "SGST", w: 1.5, align: "right" },
                { label: "Total GST", w: 1.5, align: "right" },
              ]}
              rows={taxes.map(([bps, v]) => [`${Number(bps) / 100}%`, rs(v.taxable), rs(v.cgst), rs(v.sgst), rs(v.cgst + v.sgst)])}
            />
          </View>
        ) : null}
        {z.drawers.length ? (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>CASH DRAWERS</Text>
            <Table
              cols={[
                { label: "Counter", w: 2.2 },
                { label: "Opening", w: 1.3, align: "right" },
                { label: "Cash sales", w: 1.4, align: "right" },
                { label: "In / out", w: 1.3, align: "right" },
                { label: "Expected", w: 1.4, align: "right" },
                { label: "Counted", w: 1.4, align: "right" },
                { label: "Difference", w: 1.4, align: "right" },
              ]}
              rows={z.drawers.map((d) => {
                const io = d.cash.paidIn - d.cash.paidOut - d.cash.drops - d.cash.refunds;
                const v = d.variancePaise;
                return [terminalNames[d.terminalId] ?? "Counter", rs(d.floatPaise), rs(d.cash.sales), rs(io), rs(d.expectedPaise), d.countedPaise == null ? "Not counted" : rs(d.countedPaise), v == null ? "—" : v === 0 ? "Matches" : `${v < 0 ? "Short" : "Over"} ${rs(Math.abs(v))}`];
              })}
            />
          </View>
        ) : null}
        <View style={s.cols}>
          <View style={[s.col, s.section]} wrap={false}>
            <Text style={s.h2}>OTHER</Text>
            <Lines rows={other} />
          </View>
          <View style={[s.col, s.section]} wrap={false}>
            <Text style={s.h2}>INVOICES</Text>
            {z.invoiceRanges.length ? (
              <Table
                cols={[
                  { label: "Series", w: 1 },
                  { label: "From – to", w: 3 },
                  { label: "Bills", w: 1, align: "right" },
                ]}
                rows={z.invoiceRanges.map((r) => [r.series, `${r.first} – ${r.last}`, `${r.count}${r.cancelled ? ` (${r.cancelled} cancelled)` : ""}`])}
              />
            ) : (
              <Text style={s.muted}>No bills.</Text>
            )}
          </View>
        </View>
        {corrections.length ? (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>CHANGES AFTER CLOSE</Text>
            {corrections.map((c, k) => (
              <View key={k} style={s.tr}>
                <Text style={{ width: 110, color: MUTED }}>{istDateTimeLabel(c.atMs)}</Text>
                <Text style={{ flex: 1 }}>
                  {correctionText(c, terminalNames)}
                  {c.note ? ` Why: ${c.note}` : ""}
                  {c.byName ? ` (${c.byName})` : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Footer madeAtMs={madeAtMs} />
      </Page>
    </Document>
  );
}

function ItemsPdf({ sales, client, businessDate, zNo, madeAtMs }: { sales: ItemSales; client: Client; businessDate: string; zNo?: number; madeAtMs: number }) {
  return (
    <Document title={`Item sales · ${client.name} · ${businessDate}`} author="PX POS" creator="PX POS">
      <Page size="A4" style={s.page}>
        <Header kind="ITEM SALES" number={zNo ? `Z #${zNo}` : undefined} client={client} title={`Business day ${bizDateLabel(businessDate, true)}`} sub="Every dish and size sold, biggest first. Gross is menu price × quantity, GST included." />
        <Kpis
          items={[
            ["Gross", rs(sales.grossPaise)],
            ["Items sold", String(sales.qty)],
            ["Dishes", String(sales.rows.length)],
            ["Bills", String(sales.bills)],
          ]}
        />
        <View style={s.section}>
          {sales.rows.length ? (
            <Table
              zebra
              cols={[
                { label: "#", w: 0.5 },
                { label: "Item", w: 4 },
                { label: "Size", w: 1.4 },
                { label: "Qty", w: 0.9, align: "right" },
                { label: "Gross", w: 1.6, align: "right" },
                { label: "Discounts", w: 1.4, align: "right" },
                { label: "Taxable value", w: 1.7, align: "right" },
              ]}
              rows={sales.rows.map((r, k) => [String(k + 1), r.name, r.variantName ?? "", String(r.qty), rs(r.grossPaise), r.discPaise ? rs(-r.discPaise) : "—", rs(r.taxablePaise)])}
              total={["", `Total (${sales.rows.length} item${sales.rows.length === 1 ? "" : "s"})`, "", String(sales.qty), rs(sales.grossPaise), sales.discPaise ? rs(-sales.discPaise) : "—", rs(sales.taxablePaise)]}
            />
          ) : (
            <Text style={s.muted}>No bills on this day.</Text>
          )}
        </View>
        <Footer madeAtMs={madeAtMs} />
      </Page>
    </Document>
  );
}

export async function zReportPdf(i: { z: ZReport; client: Client; terminalNames: Record<string, string>; corrections: DayCorrection[]; madeAtMs: number }): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ZReportPdf {...i} />);
}

export async function itemSalesPdf(i: { sales: ItemSales; client: Client; businessDate: string; zNo?: number; madeAtMs: number }): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ItemsPdf {...i} />);
}
