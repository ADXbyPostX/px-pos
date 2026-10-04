import type { Metadata } from "next";
import { AdminsView } from "./admins-view";

export const metadata: Metadata = { title: "Admins" };

export default function AdminsPage() {
  return <AdminsView />;
}
