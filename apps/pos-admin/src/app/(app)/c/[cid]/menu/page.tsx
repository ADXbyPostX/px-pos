import type { Metadata } from "next";
import { MenuView } from "./menu-view";

export const metadata: Metadata = { title: "Menu" };

export default function MenuPage() {
  return <MenuView />;
}
