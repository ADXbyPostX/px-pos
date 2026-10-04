import type { Metadata } from "next";
import { ClientTerminalsView } from "./terminals-view";

export const metadata: Metadata = { title: "Terminals" };

export default function ClientTerminalsPage() {
  return <ClientTerminalsView />;
}
