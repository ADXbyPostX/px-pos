"use client";

import { ErrorPanel } from "@/components/shared/loadable";

export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel error={error} onRetry={retry} className="flex-1" />;
}
