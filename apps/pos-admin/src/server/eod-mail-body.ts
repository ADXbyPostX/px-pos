import "server-only";

import { ADMIN_ORIGIN, bizDateLabel, eodMailSummary, formatINR, itemLabel, type ItemSales, type ZReport } from "@px-pos/core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The end-of-day email around the two PDFs: the day's figures, its five best sellers and a link to
 * the day in PX POS. Plain inline styles on white (mail clients ignore stylesheets).
 */
export function eodMailBody(i: { outletName: string; cid: string; z: ZReport; sales: ItemSales; corrected: boolean }): { html: string; text: string } {
  const day = bizDateLabel(i.z.businessDate, true);
  const summary = eodMailSummary(i.z);
  const top = i.sales.rows.slice(0, 5);
  const link = `${ADMIN_ORIGIN}/c/${encodeURIComponent(i.cid)}/day`;
  const row = (l: string, v: string, strong = false) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eeeeee;color:${strong ? "#111111" : "#555555"}">${esc(l)}</td><td style="padding:6px 0;border-bottom:1px solid #eeeeee;text-align:right;font-weight:${strong ? 700 : 400};color:#111111">${esc(v)}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="height:4px;background:#fc0303"></td></tr>
<tr><td style="padding:24px 28px 8px">
<div style="font-size:12px;letter-spacing:1px;color:#777777;font-weight:600">END OF DAY · Z ${i.z.zNo}</div>
<div style="font-size:20px;font-weight:700;color:#111111;margin-top:4px">${esc(i.outletName)}</div>
<div style="font-size:14px;color:#555555;margin-top:2px">Business day ${esc(day)}</div>
${i.corrected ? `<div style="display:inline-block;margin-top:8px;font-size:11px;font-weight:600;color:#fc0303;border:1px solid #fc0303;border-radius:3px;padding:2px 6px">CORRECTED AFTER CLOSE</div>` : ""}
</td></tr>
<tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${summary.map(([l, v], k) => row(l, v, k === 0)).join("\n")}
</table></td></tr>
${
  top.length
    ? `<tr><td style="padding:16px 28px 0"><div style="font-size:12px;letter-spacing:1px;color:#777777;font-weight:600">BEST SELLERS</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:4px">
${top.map((r) => row(`${itemLabel(r)} × ${r.qty}`, formatINR(r.grossPaise))).join("\n")}
</table></td></tr>`
    : ""
}
<tr><td style="padding:20px 28px 8px;font-size:14px;color:#333333">The Z report and the item sales for every dish are attached as PDFs.</td></tr>
<tr><td style="padding:8px 28px 24px"><a href="${link}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px">Open the day in PX POS</a></td></tr>
<tr><td style="padding:14px 28px;background:#fafafa;font-size:12px;color:#888888">You get this because ${esc(i.outletName)} added you to its end-of-day list in PX POS. Ask them to take you off it.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${i.outletName}: end of day, ${day} (Z ${i.z.zNo})${i.corrected ? " (corrected after close)" : ""}`,
    "",
    ...summary.map(([l, v]) => `${l}: ${v}`),
    ...(top.length ? ["", "Best sellers:", ...top.map((r) => `  ${itemLabel(r)} x ${r.qty}: ${formatINR(r.grossPaise)}`)] : []),
    "",
    "The Z report and the item sales are attached as PDFs.",
    `Open the day in PX POS: ${link}`,
  ].join("\n");
  return { html, text };
}
