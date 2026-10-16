import type { Metadata } from "next";
import { LedgerView } from "./ledger-view";

export const metadata: Metadata = { title: "Stock ledger" };

export default function LedgerPage() {
  return <LedgerView />;
}
