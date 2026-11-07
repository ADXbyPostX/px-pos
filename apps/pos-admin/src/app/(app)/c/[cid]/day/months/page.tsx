import type { Metadata } from "next";
import { MonthsView } from "./months-view";

export const metadata: Metadata = { title: "Months" };

export default function MonthsPage() {
  return <MonthsView />;
}
