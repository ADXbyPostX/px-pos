"use client";

import type { ComponentProps } from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";

/**
 * The ⋯ menu of a table row. React passes events from a portal up its component tree, so a pick
 * in the menu would also reach the row and open its sheet over the dialog the pick opened (and
 * Enter would trigger the row's Enter). Stop both here. Escape still closes the menu: Radix
 * catches it on the document before React sees it.
 */
export function RowMenuContent({ onClick, onKeyDown, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      align="end"
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        onKeyDown?.(e);
      }}
    />
  );
}
