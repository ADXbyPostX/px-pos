/**
 * Sidebar + breadcrumb model. Pure (no React), so it is testable and shared by the
 * sidebar, header breadcrumb and command palette. Icons are string keys resolved in the sidebar.
 */
export type NavIcon =
  | "globe"
  | "building"
  | "shield"
  | "monitor"
  | "summary"
  | "floor"
  | "orders"
  | "transactions"
  | "kot"
  | "income"
  | "expenses"
  | "day"
  | "stock"
  | "menu"
  | "tables"
  | "modes"
  | "staff"
  | "terminals"
  | "settings"
  | "audit"
  | "reconcile"
  | "seed";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href: string; icon: NavIcon; children?: NavChild[] };
export type NavGroup = { label: string; items: NavItem[] };

export type Role = "superadmin" | "admin";

export const devToolsEnabled = process.env.NEXT_PUBLIC_DEV_PERSONAS === "1";

/** Client-scoped sections. `c` = "/c/{cid}". */
function clientGroups(c: string, role: Role): NavGroup[] {
  const setup: NavItem[] = [
    { label: "Order modes", href: `${c}/modes`, icon: "modes" },
    { label: "Staff", href: `${c}/staff`, icon: "staff" },
    { label: "Terminals", href: `${c}/terminals`, icon: "terminals" },
    { label: "Settings", href: `${c}/settings`, icon: "settings" },
    { label: "Audit", href: `${c}/audit`, icon: "audit" },
  ];
  if (role === "superadmin") setup.push({ label: "Reconcile", href: `${c}/reconcile`, icon: "reconcile" });
  return [
    {
      label: "Overview",
      items: [
        { label: "Summary", href: c, icon: "summary" },
        { label: "Live floor", href: `${c}/live`, icon: "floor" },
      ],
    },
    {
      label: "Sales",
      items: [
        { label: "Orders", href: `${c}/orders`, icon: "orders" },
        { label: "Transactions", href: `${c}/transactions`, icon: "transactions" },
        {
          label: "KOT",
          href: `${c}/kot`,
          icon: "kot",
          children: [
            { label: "Board", href: `${c}/kot` },
            { label: "Log", href: `${c}/kot/log` },
          ],
        },
      ],
    },
    {
      label: "Money",
      items: [
        {
          label: "Income",
          href: `${c}/income`,
          icon: "income",
          children: [
            { label: "Profit & loss", href: `${c}/income` },
            { label: "GST", href: `${c}/income/gst` },
          ],
        },
        { label: "Expenses", href: `${c}/expenses`, icon: "expenses" },
        { label: "End of day", href: `${c}/day`, icon: "day" },
      ],
    },
    {
      label: "Inventory",
      items: [
        {
          label: "Stock",
          href: `${c}/stock`,
          icon: "stock",
          children: [
            { label: "Live", href: `${c}/stock` },
            { label: "End of day", href: `${c}/stock/eod` },
            { label: "Ledger", href: `${c}/stock/ledger` },
          ],
        },
      ],
    },
    {
      label: "Menu",
      items: [
        {
          label: "Items",
          href: `${c}/menu`,
          icon: "menu",
          children: [
            { label: "Items", href: `${c}/menu` },
            { label: "Categories", href: `${c}/menu/categories` },
          ],
        },
        { label: "Tables", href: `${c}/tables`, icon: "tables" },
      ],
    },
    { label: "Setup", items: setup },
  ];
}

function platformGroup(role: Role): NavGroup {
  const items: NavItem[] = [{ label: "Overview", href: "/", icon: "globe" }];
  if (role === "superadmin") {
    items.push(
      { label: "Clients", href: "/clients", icon: "building" },
      { label: "Admins", href: "/admins", icon: "shield" },
      { label: "All terminals", href: "/terminals", icon: "monitor" },
    );
  } else {
    items.push({ label: "My clients", href: "/clients", icon: "building" });
  }
  if (devToolsEnabled) items.push({ label: "Demo data", href: "/dev/seed", icon: "seed" });
  return { label: "Platform", items };
}

export function navFor(role: Role, cid: string | null): NavGroup[] {
  return cid ? [...clientGroups(`/c/${cid}`, role), platformGroup(role)] : [platformGroup(role)];
}

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // The client summary (/c/{cid}) is only active on itself.
  if (/^\/c\/[^/]+$/.test(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Breadcrumb trail: the deepest nav item/child matching the path. */
export function trailFor(groups: NavGroup[], pathname: string): { item: NavItem; child?: NavChild } | null {
  let best: { item: NavItem; child?: NavChild; len: number } | null = null;
  for (const g of groups) {
    for (const item of g.items) {
      for (const child of item.children ?? []) {
        const hit = child.href === item.href ? pathname === child.href : isActivePath(pathname, child.href);
        if (hit && (!best || child.href.length > best.len)) best = { item, child, len: child.href.length };
      }
      if (isActivePath(pathname, item.href) && (!best || item.href.length > best.len)) best = { item, len: item.href.length };
    }
  }
  return best ? { item: best.item, ...(best.child ? { child: best.child } : {}) } : null;
}

/** Flat list for the command palette. */
export function flatNav(groups: NavGroup[]): Array<{ label: string; href: string; group: string }> {
  const out: Array<{ label: string; href: string; group: string }> = [];
  for (const g of groups)
    for (const it of g.items) {
      if (it.children?.length) for (const c of it.children) out.push({ label: c.label === it.label ? it.label : `${it.label} · ${c.label}`, href: c.href, group: g.label });
      else out.push({ label: it.label, href: it.href, group: g.label });
    }
  return out;
}
