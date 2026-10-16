import type { Metadata } from "next";
import { PurchasesView } from "./purchases-view";

export const metadata: Metadata = { title: "Purchases" };

export default function PurchasesPage() {
  return <PurchasesView />;
}
