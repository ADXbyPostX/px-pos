import type { Metadata } from "next";
import { UsageView } from "./usage-view";

export const metadata: Metadata = { title: "Stock usage" };

export default function UsagePage() {
  return <UsageView />;
}
