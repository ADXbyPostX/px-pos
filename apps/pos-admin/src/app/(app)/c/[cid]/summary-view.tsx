"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Stat, Stats } from "@/components/shared/stat";
import { useClient } from "@/components/providers/client-provider";

/** Executive summary — built out in M7 (reports). */
export function SummaryView() {
  const { client } = useClient();
  return (
    <>
      <PageHeader title={`${client.name} summary`} />
      <Stats>
        <Stat label="Net sales" value="—" />
        <Stat label="Orders" value="—" />
        <Stat label="Average order" value="—" />
        <Stat label="Expenses" value="—" />
      </Stats>
    </>
  );
}
