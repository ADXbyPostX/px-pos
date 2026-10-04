import type { Metadata } from "next";
import { SummaryView } from "./summary-view";

export const metadata: Metadata = { title: "Summary" };

export default function SummaryPage() {
  return <SummaryView />;
}
