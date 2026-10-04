import type { Metadata } from "next";
import { ModesView } from "./modes-view";

export const metadata: Metadata = { title: "Order modes" };

export default function ModesPage() {
  return <ModesView />;
}
