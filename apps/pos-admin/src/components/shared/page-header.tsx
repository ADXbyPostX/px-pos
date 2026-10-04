import type { ReactNode } from "react";
import { HeaderActions } from "@/components/layout/header-actions";

/**
 * The page title lives in the sidebar and breadcrumb, so it is kept for screen
 * readers only. Toolbars and primary actions render into the top bar.
 */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {actions ? <HeaderActions>{actions}</HeaderActions> : null}
    </>
  );
}
