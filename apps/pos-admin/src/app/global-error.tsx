"use client";

import "./globals.css";

/** Replaces the root layout when it crashes, so it brings its own <html>/<body>. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en-IN" className="dark h-full">
      <body className="flex min-h-full flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-widest text-muted-foreground">ERROR{error.digest ? ` · ${error.digest}` : ""}</p>
          <h1 className="text-xl font-medium">PX POS hit an unexpected error</h1>
          <p className="max-w-md text-sm text-muted-foreground">Your data is safe. Try again, or reload the page.</p>
        </div>
        <button type="button" onClick={() => retry()} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80">
          Try again
        </button>
      </body>
    </html>
  );
}
