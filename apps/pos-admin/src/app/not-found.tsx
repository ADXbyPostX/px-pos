import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <div aria-hidden className="bg-ember" />
      <Image src={brand.mark.src} alt={brand.mark.alt} width={brand.mark.width} height={brand.mark.height} priority unoptimized className="size-20" />
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-widest text-muted-foreground">404</p>
        <h1 className="text-xl font-medium">Page not found</h1>
      </div>
      <Button asChild>
        <Link href="/">Back to overview</Link>
      </Button>
    </main>
  );
}
