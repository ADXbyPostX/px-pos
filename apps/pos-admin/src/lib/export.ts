/** Comma-separated, quoted where needed. */
export const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Rupees with two decimals for a spreadsheet ("1234.50"). */
export const csvRupees = (p: number | undefined) => ((p ?? 0) / 100).toFixed(2);

export const csvText = (rows: Array<Array<string | number>>) => rows.map((l) => l.map(csvCell).join(",")).join("\n");

/** A file name from a label: "Tea Room, Kodambakkam" → "Tea-Room-Kodambakkam". */
export const fileSafe = (s: string) => s.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");

export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A report as it prints on the till, in a print window. */
export function printText(title: string, text: string) {
  const w = window.open("", "_blank", "width=480,height=720");
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  w.document.write(`<!doctype html><title>${esc(title)}</title><pre style="font:12px/1.35 ui-monospace,Menlo,monospace;margin:16px">${esc(text)}</pre>`);
  w.document.close();
  w.focus();
  w.print();
}
