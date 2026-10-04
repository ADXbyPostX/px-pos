import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const store = await cookies();
  const defaultOpen = store.get("sidebar_state")?.value !== "false";
  return <AppShell defaultOpen={defaultOpen}>{children}</AppShell>;
}
