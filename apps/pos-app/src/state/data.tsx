import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { collection, query, where } from "@react-native-firebase/firestore";
import {
  businessDateFor,
  paths,
  photoUri,
  type BizDate,
  type Category,
  type DailyStats,
  type Day,
  type Drawer,
  type Floor,
  type Item,
  type ItemPhoto,
  type Kot,
  type Order,
  type Staff,
  type StockDoc,
  type Table,
} from "@px-pos/core";
import { useLiveDoc, useLiveQuery, useNow, type WithId } from "@/hooks/use-live";
import { getMeta, setMeta } from "@/local/db";
import { usePaired } from "./session";

interface ClientData {
  categories: WithId<Category>[];
  items: WithId<Item>[];
  itemsById: Map<string, WithId<Item>>;
  /** Dish photos (data URIs) by item id — cached offline like the rest of the menu. */
  photos: Map<string, string>;
  stock: Map<string, number>;
  tracked: ReadonlySet<string>;
  floors: WithId<Floor>[];
  tables: WithId<Table>[];
  staff: WithId<Staff>[];
  openOrders: WithId<Order>[];
  kots: WithId<Kot>[];
  /** This terminal's open business day (null until the drawer is opened). */
  bizDate: BizDate | null;
  suggestedBizDate: BizDate;
  day: WithId<Day> | null;
  drawer: WithId<Drawer> | null;
  stats: WithId<DailyStats> | null;
  setBizDate: (d: BizDate | null) => void;
  menuReady: boolean;
  /** Open orders have loaded (from cache or server) — before this, "not found" means "not yet". */
  ordersReady: boolean;
}

const Ctx = createContext<ClientData | null>(null);

export function useData(): ClientData {
  const v = use(Ctx);
  if (!v) throw new Error("useData outside DataProvider");
  return v;
}

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;

/** Everything a terminal needs, live from the native cache (works offline after the first sync). */
export function DataProvider({ children }: { children: ReactNode }) {
  const { cid, tid, client } = usePaired();
  const [bizDate, setBizDateState] = useState<BizDate | null>(() => getMeta(`bizDate:${cid}`));
  const setBizDate = useCallback(
    (d: BizDate | null) => {
      setMeta(`bizDate:${cid}`, d);
      setBizDateState(d);
    },
    [cid],
  );

  const categories = useLiveQuery<Category>(`cat:${cid}`, (db) => query(collection(db, paths.col(cid, "categories")), where("active", "==", true)));
  const items = useLiveQuery<Item>(`items:${cid}`, (db) => query(collection(db, paths.col(cid, "items")), where("active", "==", true)));
  const photos = useLiveQuery<ItemPhoto>(`photos:${cid}`, (db) => query(collection(db, paths.col(cid, "itemPhotos")), where("active", "==", true)));
  const stock = useLiveQuery<StockDoc>(`stock:${cid}`, (db) => collection(db, paths.col(cid, "stock")));
  const floors = useLiveQuery<Floor>(`floors:${cid}`, (db) => query(collection(db, paths.col(cid, "floors")), where("active", "==", true)));
  const tables = useLiveQuery<Table>(`tables:${cid}`, (db) => query(collection(db, paths.col(cid, "tables")), where("active", "==", true)));
  const staff = useLiveQuery<Staff>(`staff:${cid}`, (db) => query(collection(db, paths.col(cid, "staff")), where("active", "==", true)));
  const openOrders = useLiveQuery<Order>(`open:${cid}`, (db) => query(collection(db, paths.col(cid, "orders")), where("status", "in", ["open", "billed"])));
  const kots = useLiveQuery<Kot>(bizDate ? `kots:${cid}:${bizDate}` : null, (db) => query(collection(db, paths.col(cid, "kots")), where("businessDate", "==", bizDate)));
  const day = useLiveDoc<Day>(bizDate ? paths.day(cid, bizDate) : null);
  const drawer = useLiveDoc<Drawer>(bizDate ? paths.drawer(cid, bizDate, tid) : null);
  const stats = useLiveDoc<DailyStats>(bizDate ? paths.dailyStats(cid, bizDate) : null);
  const now = useNow(60_000);

  // Its identity changes only when a photo does, so tiles don't re-decode images on stock ticks.
  const photoMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of photos.data) {
      const uri = photoUri(p);
      if (uri) m.set(p.id, uri);
    }
    return m;
  }, [photos.data]);

  const value = useMemo<ClientData>(() => {
    const sortedItems = [...items.data].sort(bySort);
    return {
      categories: [...categories.data].sort(bySort),
      items: sortedItems,
      itemsById: new Map(sortedItems.map((i) => [i.id, i])),
      photos: photoMap,
      stock: new Map(stock.data.map((s) => [s.id, s.onHand])),
      tracked: new Set(sortedItems.filter((i) => i.trackStock).map((i) => i.id)),
      floors: [...floors.data].sort(bySort),
      tables: [...tables.data].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "en", { numeric: true })),
      staff: [...staff.data].sort((a, b) => a.name.localeCompare(b.name)),
      openOrders: openOrders.data,
      kots: kots.data,
      bizDate,
      suggestedBizDate: businessDateFor(now, client.day.cutoffMin),
      day: day.data,
      drawer: drawer.data,
      stats: stats.data,
      setBizDate,
      menuReady: categories.status === "ready" && items.status === "ready",
      ordersReady: openOrders.status !== "loading",
    };
  }, [categories, items, photoMap, stock, floors, tables, staff, openOrders, kots, bizDate, day, drawer, stats, setBizDate, now, client.day.cutoffMin]);

  return <Ctx value={value}>{children}</Ctx>;
}
