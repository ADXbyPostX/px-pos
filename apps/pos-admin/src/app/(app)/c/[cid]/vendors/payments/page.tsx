import type { Metadata } from "next";
import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Vendor payments" };

export default function PaymentsPage() {
  return <PaymentsView />;
}
