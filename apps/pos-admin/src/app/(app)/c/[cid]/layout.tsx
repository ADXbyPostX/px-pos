import { ClientProvider } from "@/components/providers/client-provider";

export default async function ClientLayout({ children, params }: LayoutProps<"/c/[cid]">) {
  const { cid } = await params;
  return <ClientProvider cid={decodeURIComponent(cid)}>{children}</ClientProvider>;
}
