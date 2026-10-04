"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Armchair,
  Building2,
  CalendarCheck,
  ChefHat,
  ChevronRight,
  FlaskConical,
  Globe,
  History,
  LayoutDashboard,
  LayoutGrid,
  MonitorSmartphone,
  Package,
  Receipt,
  Scale,
  Settings,
  ShieldCheck,
  Tablet,
  ToggleRight,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { brand } from "@/lib/brand";
import { isActivePath, navFor, type NavIcon } from "@/lib/nav";
import { usePrincipal } from "@/components/providers/principal-provider";
import { ClientSwitcher } from "./client-switcher";
import { NavUser } from "./nav-user";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  globe: Globe,
  building: Building2,
  shield: ShieldCheck,
  monitor: MonitorSmartphone,
  summary: LayoutDashboard,
  floor: LayoutGrid,
  orders: Receipt,
  transactions: ArrowLeftRight,
  kot: ChefHat,
  income: TrendingUp,
  expenses: Wallet,
  day: CalendarCheck,
  stock: Package,
  menu: UtensilsCrossed,
  tables: Armchair,
  modes: ToggleRight,
  staff: Users,
  terminals: Tablet,
  settings: Settings,
  audit: History,
  reconcile: Scale,
  seed: FlaskConical,
};

export function AppSidebar() {
  const pathname = usePathname();
  const params = useParams<{ cid?: string }>();
  const { effective } = usePrincipal();
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  const groups = navFor(effective?.role ?? "admin", params.cid ?? null);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b px-3 group-data-[collapsible=icon]:px-0">
        <Link href="/" aria-label={`${brand.name} home`} onClick={close} className="flex h-8 items-center justify-center">
          <Image src={brand.wordmark.src} alt={brand.wordmark.alt} width={brand.wordmark.width} height={brand.wordmark.height} priority unoptimized className="h-7 w-auto group-data-[collapsible=icon]:hidden" />
          <Image src={brand.mark.src} alt={brand.mark.alt} width={brand.mark.width} height={brand.mark.height} unoptimized className="hidden size-7 object-contain group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pb-0">
          <ClientSwitcher />
        </SidebarGroup>
        <SidebarSeparator className="mx-0" />
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const Icon = NAV_ICONS[item.icon];
                  if (!item.children || item.children.length <= 1) {
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link href={item.href} onClick={close}>
                            <Icon aria-hidden />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <Collapsible key={item.href} asChild defaultOpen={active} className="group/collapsible">
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link href={item.href} onClick={close}>
                            <Icon aria-hidden />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuAction className="data-[state=open]:rotate-90" aria-label={`Toggle ${item.label}`}>
                            <ChevronRight aria-hidden />
                          </SidebarMenuAction>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child) => {
                              const childActive = child.href === item.href ? pathname === child.href : isActivePath(pathname, child.href);
                              return (
                                <SidebarMenuSubItem key={child.href}>
                                  <SidebarMenuSubButton asChild isActive={childActive}>
                                    <Link href={child.href} onClick={close}>
                                      <span>{child.label}</span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
