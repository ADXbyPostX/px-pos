import type { Metadata } from "next";
import { DayView } from "./day-view";

export const metadata: Metadata = { title: "End of day" };

export default function DayPage() {
  return <DayView />;
}
