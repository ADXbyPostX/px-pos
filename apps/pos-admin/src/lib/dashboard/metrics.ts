/** Chart and stat shapes shared by the report pages. */
export type Trend = { value: number; prev: number };
export type Point = { label: string } & Record<string, number | string>;
export type Slice = { name: string; value: number };
