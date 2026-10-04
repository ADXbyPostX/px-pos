"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * On desktop the container clips instead of scrolling so the header can stick to the page's
 * scroll pane. A table wider than its card must never be cut off, though: it measures itself
 * and falls back to horizontal scrolling (giving up the sticky header) while it doesn't fit.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const box = React.useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = React.useState(false)
  React.useEffect(() => {
    const el = box.current
    const table = el?.querySelector<HTMLTableElement>(":scope > table")
    if (!el || !table) return
    // Fires once on observe, then whenever the card or the table changes width.
    const ro = new ResizeObserver(() => setOverflowing(table.offsetWidth > el.clientWidth + 1))
    ro.observe(el)
    ro.observe(table)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={box}
      data-slot="table-container"
      data-overflowing={overflowing || undefined}
      className={cn("relative w-full overflow-x-auto", !overflowing && "lg:overflow-x-clip")}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky -top-4 z-10 bg-card md:-top-6 [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
