"use client";

import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sort value; the column is sortable when present. */
  sort?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  className?: string;
  headClassName?: string;
  /** Hide on narrower desktop widths to keep the table readable. */
  hideBelow?: "md" | "lg" | "xl" | "2xl";
  /** Footer cell (totals row). */
  footer?: ReactNode;
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

/**
 * Dense back-office table (px-ops pattern): shadcn Table in a card with a sticky header on
 * sm+, a card list on phones. Rows are keyboard reachable (↑/↓ to move, Enter to open).
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  mobileRow,
  initialSort,
  selectedKey,
  caption,
  className,
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Phone card; defaults to the first two columns. */
  mobileRow?: (row: T) => ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
  selectedKey?: string | null;
  caption?: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const uid = useId();
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "en", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, columns, sort]);

  const hasFooter = columns.some((c) => c.footer !== undefined);
  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" }));

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (e.key === "Enter" && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    } else if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
    }
  }

  const align = (a?: Column<T>["align"]) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <>
      <div className={cn("hidden overflow-clip rounded-xl border bg-card sm:block", className)}>
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <TableHead
                    key={c.key}
                    className={cn("px-3 text-xs font-medium text-muted-foreground", align(c.align), c.hideBelow && HIDE[c.hideBelow], c.headClassName)}
                    aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", c.align === "right" && "flex-row-reverse", active && "text-foreground")}
                      >
                        {c.header}
                        {active ? sort?.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3 opacity-40" aria-hidden />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => {
              const key = rowKey(row);
              return (
                <TableRow
                  key={key}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => onKeyDown(e, row) : undefined}
                  data-state={selectedKey === key ? "selected" : undefined}
                  className={cn("h-11", onRowClick && "cursor-pointer outline-none focus-visible:bg-muted/60", rowClassName?.(row))}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn("px-3", align(c.align), c.align === "right" && "tabular-nums", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
          {hasFooter ? (
            <TableFooter className="sticky -bottom-4 z-10 bg-card md:-bottom-6">
              <TableRow className="hover:bg-transparent">
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("px-3 font-medium", align(c.align), c.align === "right" && "tabular-nums", c.hideBelow && HIDE[c.hideBelow])}>
                    {c.footer ?? null}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
      <ul className={cn("divide-y overflow-clip rounded-xl border bg-card sm:hidden", className)}>
        {sorted.map((row) => {
          const key = rowKey(row);
          const content = mobileRow ? (
            mobileRow(row)
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm">{columns[0]?.cell(row)}</div>
              <div className="shrink-0 text-sm tabular-nums">{columns[columns.length - 1]?.cell(row)}</div>
            </div>
          );
          return (
            <li key={key} className={onRowClick ? "relative hover:bg-muted/50 has-[>button:focus-visible]:bg-muted/60" : undefined}>
              {/* The tap target overlays the card instead of wrapping it: rows may hold their own
                  controls (switches, menus), and a <button> can't contain another. */}
              {onRowClick ? <button type="button" onClick={() => onRowClick(row)} aria-labelledby={`${uid}-${key}`} className="absolute inset-0 focus-visible:outline-none" /> : null}
              <div id={`${uid}-${key}`} className={cn("px-4 py-3", onRowClick && "pointer-events-none relative min-h-11 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto")}>
                {content}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
