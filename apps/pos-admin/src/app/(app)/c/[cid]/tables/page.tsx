import type { Metadata } from "next";
import { TablesView } from "./tables-view";

export const metadata: Metadata = { title: "Tables" };

export default function TablesPage() {
  return <TablesView />;
}
