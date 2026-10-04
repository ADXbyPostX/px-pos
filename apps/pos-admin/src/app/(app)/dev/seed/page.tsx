import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeedView } from "./seed-view";

export const metadata: Metadata = { title: "Demo data" };

export default function SeedPage() {
  // Dev tool only: absent unless NEXT_PUBLIC_DEV_PERSONAS=1.
  if (process.env.NEXT_PUBLIC_DEV_PERSONAS !== "1") notFound();
  return <SeedView />;
}
