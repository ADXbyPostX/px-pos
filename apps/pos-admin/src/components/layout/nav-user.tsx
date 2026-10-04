"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where } from "firebase/firestore";
import { ChevronsUpDown, Copy, Eye, EyeOff, KeyRound, LockKeyhole, LogOut } from "lucide-react";
import { toast } from "sonner";
import { paths, type PlatformUser } from "@px-pos/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useAuth } from "@/components/providers/firebase-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useCollection } from "@/lib/firebase/hooks";
import { devToolsEnabled } from "@/lib/nav";
import { ChangePasswordDialog } from "./change-password-dialog";
import { SecureAccountDialog } from "./secure-account-dialog";

const ROLE_LABEL = { superadmin: "Super admin", admin: "Admin" } as const;

export function NavUser() {
  const { isMobile } = useSidebar();
  const auth = useAuth();
  const { principal, persona, setPersona } = usePrincipal();
  const router = useRouter();
  const [secureOpen, setSecureOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const canPreview = devToolsEnabled && principal?.role === "superadmin";
  // Equality-only query (no composite index); sorted client-side.
  const adminsLive = useCollection<PlatformUser>(canPreview ? "platformUsers:admins" : null, (db) => query(collection(db, paths.platformUsers()), where("role", "==", "admin")));
  const admins = { ...adminsLive, data: [...adminsLive.data].sort((a, b) => a.name.localeCompare(b.name)) };

  if (!principal) return null;
  const email = auth.user?.email;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" aria-label="Account menu">
              <UserAvatar name={principal.name} size="default" />
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{principal.name}</span>
                <span className="truncate text-xs text-muted-foreground">{persona ? `Previewing ${persona.name}` : ROLE_LABEL[principal.role]}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={8} className="w-(--radix-dropdown-menu-trigger-width) min-w-64">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate font-medium">{principal.name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{email ?? "Not linked to an email yet"}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard?.writeText(principal.id).then(() => toast.success("User ID copied"));
              }}
            >
              <Copy aria-hidden />
              <span className="truncate">Copy user ID</span>
            </DropdownMenuItem>
            {auth.isAnonymous ? (
              <DropdownMenuItem onSelect={() => setSecureOpen(true)}>
                <KeyRound aria-hidden />
                Secure this account
              </DropdownMenuItem>
            ) : null}
            {auth.hasPassword ? (
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                <LockKeyhole aria-hidden />
                Change password
              </DropdownMenuItem>
            ) : null}
            {canPreview ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Eye aria-hidden />
                  Preview as admin
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52">
                  {admins.data.length === 0 ? <DropdownMenuItem disabled>No admins yet</DropdownMenuItem> : null}
                  {admins.data.map((a) => (
                    <DropdownMenuItem key={a.id} onSelect={() => setPersona(a.id)}>
                      {a.name}
                    </DropdownMenuItem>
                  ))}
                  {persona ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setPersona(null)}>
                        <EyeOff aria-hidden />
                        Stop preview
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {!auth.isAnonymous ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    await auth.signOut();
                    router.replace("/setup");
                  }}
                >
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <SecureAccountDialog open={secureOpen} onOpenChange={setSecureOpen} defaultName={principal.name} />
        <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
