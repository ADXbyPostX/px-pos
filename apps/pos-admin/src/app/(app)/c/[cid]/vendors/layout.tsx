import { VendorActionsProvider } from "@/components/vendors/vendor-actions";

/** Vendors, Purchases and Payments share their listeners, sheets and dialogs. */
export default function VendorsLayout({ children }: LayoutProps<"/c/[cid]/vendors">) {
  return <VendorActionsProvider>{children}</VendorActionsProvider>;
}
