import makeQr from "qrcode-generator";

/** QR modules for `text`, one string per row ("1" = dark). */
export function qrRows(text: string, ecc: "L" | "M" = "M"): string[] {
  const q = makeQr(0, ecc);
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const rows: string[] = [];
  for (let r = 0; r < n; r++) {
    let row = "";
    for (let c = 0; c < n; c++) row += q.isDark(r, c) ? "1" : "0";
    rows.push(row);
  }
  return rows;
}
