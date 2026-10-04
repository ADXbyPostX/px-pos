import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FirebaseProvider } from "@/components/providers/firebase-provider";
import { PrincipalProvider } from "@/components/providers/principal-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PX POS", template: "%s · PX POS" },
  description: "PostX point of sale — back office for outlets, menus, sales, stock and end of day.",
  applicationName: "PX POS",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <FirebaseProvider>
          <PrincipalProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </PrincipalProvider>
        </FirebaseProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
