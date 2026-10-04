/**
 * Chart colours as CSS variables from globals.css: brand red, QC blue,
 * success green, warning yellow, zinc. A plain module so both the server
 * sections and the client charts read the real strings (a "use client" export
 * would reach the server as a client reference, not a value).
 */
export const palette = {
  brand: "var(--brand)",
  qc: "var(--qc)",
  success: "var(--success)",
  warning: "var(--warning)",
  zinc: "var(--chart-4)",
  dim: "var(--chart-5)",
} as const;

export type Series = { key: string; label: string; color: string };
