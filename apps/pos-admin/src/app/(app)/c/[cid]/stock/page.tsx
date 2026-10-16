import type { Metadata } from "next";
import { StockView } from "./stock-view";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return <StockView />;
}
