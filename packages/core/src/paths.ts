/**
 * Every Firestore path in px-pos. Never hand-type a path in the apps.
 * Tenant data lives under clients/{cid}/… so rules scope by the {cid} segment.
 */
export const COL = {
  members: "members",
  terminals: "terminals",
  staff: "staff",
  categories: "categories",
  items: "items",
  itemPhotos: "itemPhotos",
  stock: "stock",
  floors: "floors",
  tables: "tables",
  customers: "customers",
  orders: "orders",
  kots: "kots",
  invoices: "invoices",
  payments: "payments",
  expenses: "expenses",
  cashMovements: "cashMovements",
  days: "days",
  drawers: "drawers",
  postings: "postings",
  dailyStats: "dailyStats",
  stockSnapshots: "stockSnapshots",
  auditLog: "auditLog",
} as const;

export type ClientCollection = (typeof COL)[keyof typeof COL];

export const paths = {
  bootstrap: () => "meta/bootstrap",
  platformUsers: () => "platformUsers",
  platformUser: (uid: string) => `platformUsers/${uid}`,
  pairingRequests: () => "pairingRequests",
  pairingRequest: (uid: string) => `pairingRequests/${uid}`,
  clients: () => "clients",
  client: (cid: string) => `clients/${cid}`,
  col: (cid: string, col: ClientCollection) => `clients/${cid}/${col}`,
  doc: (cid: string, col: ClientCollection, id: string) => `clients/${cid}/${col}/${id}`,
  member: (cid: string, uid: string) => `clients/${cid}/${COL.members}/${uid}`,
  terminal: (cid: string, tid: string) => `clients/${cid}/${COL.terminals}/${tid}`,
  order: (cid: string, id: string) => `clients/${cid}/${COL.orders}/${id}`,
  kot: (cid: string, id: string) => `clients/${cid}/${COL.kots}/${id}`,
  invoice: (cid: string, id: string) => `clients/${cid}/${COL.invoices}/${id}`,
  payment: (cid: string, id: string) => `clients/${cid}/${COL.payments}/${id}`,
  posting: (cid: string, key: string) => `clients/${cid}/${COL.postings}/${key}`,
  dailyStats: (cid: string, d: string) => `clients/${cid}/${COL.dailyStats}/${d}`,
  stock: (cid: string, itemId: string) => `clients/${cid}/${COL.stock}/${itemId}`,
  item: (cid: string, id: string) => `clients/${cid}/${COL.items}/${id}`,
  itemPhoto: (cid: string, itemId: string) => `clients/${cid}/${COL.itemPhotos}/${itemId}`,
  day: (cid: string, d: string) => `clients/${cid}/${COL.days}/${d}`,
  drawer: (cid: string, d: string, tid: string) => `clients/${cid}/${COL.drawers}/${d}_${tid}`,
  stockSnapshot: (cid: string, d: string) => `clients/${cid}/${COL.stockSnapshots}/${d}`,
  customer: (cid: string, phone10: string) => `clients/${cid}/${COL.customers}/${phone10}`,
  audit: (cid: string, id: string) => `clients/${cid}/${COL.auditLog}/${id}`,
} as const;

/** Posting keys: the exactly-once ledger id for every stats/stock-moving batch. */
export const postingKey = {
  kot: (kotId: string) => `kot:${kotId}`,
  quick: (orderId: string) => `quick:${orderId}`,
  settle: (orderId: string) => `settle:${orderId}`,
  lineVoid: (orderId: string, lineId: string, n: number) => `void:${orderId}:${lineId}:${n}`,
  ticketVoid: (orderId: string) => `tvoid:${orderId}`,
  cancelBill: (orderId: string) => `cancel:${orderId}`,
  expense: (id: string) => `exp:${id}`,
  expenseVoid: (id: string) => `expvoid:${id}`,
  cashMove: (id: string) => `cash:${id}`,
  stockMove: (id: string) => `stk:${id}`,
} as const;

/** 10-digit Indian mobile from any input ("+91 98765-43210" → "9876543210"), or null. */
export function phone10(input: string | undefined | null): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}
