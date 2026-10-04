import type { Metadata } from "next";
import { AllTerminalsView } from "./terminals-view";

export const metadata: Metadata = { title: "All terminals" };

export default function AllTerminalsPage() {
  return <AllTerminalsView />;
}
