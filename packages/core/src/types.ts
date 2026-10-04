import type { UpiAccount } from "./upi";

/**
 * px-pos domain types. Firestore documents are these shapes minus `id`.
 * Money is integer paise, rates are basis points, quantities are integers.
 */

/** Integer paise (₹1 = 100). Always a safe integer. */
export type Paise = number;
/** Basis points (500 = 5%). */
export type Bps = number;
/** Business date "YYYY-MM-DD" (IST, shifted by the client's day cutoff). */
export type BizDate = string;
/** Financial year label "26-27" (1 Apr 2026 – 31 Mar 2027). */
export type Fy = string;

export const ORDER_MODES = ["dineIn", "quick", "delivery"] as const;
export type OrderMode = (typeof ORDER_MODES)[number];

export const PAY_MODES = ["cash", "card", "upi", "other"] as const;
export type PayMode = (typeof PAY_MODES)[number];

export const STAFF_ROLES = ["owner", "manager", "cashier", "captain", "kitchen"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type TaxMode = "regular" | "composition" | "unregistered";
export type PriceMode = "exclusive" | "inclusive";
export type Rounding = "rupee" | "none";
export type FoodType = "veg" | "nonveg" | "egg";
export type Station = "kitchen" | "bar" | "beverage";
export type Unit = "pcs" | "plate" | "portion" | "g" | "ml";
export type Source = "app" | "admin" | "seed";

/** Fields every stored document carries. */
export interface Meta {
  schemaVersion: 1;
  createdAtMs: number;
  /** serverTimestamp() on write; a Firestore Timestamp when read. */
  createdAt?: unknown;
  updatedAtMs: number;
  source: Source;
}

// ─── platform ────────────────────────────────────────────────────────────────

export type PlatformRole = "superadmin" | "admin";

export interface PlatformUser extends Meta {
  role: PlatformRole;
  name: string;
  email?: string;
  active: boolean;
}

export interface Bootstrap {
  uid: string;
  atMs: number;
}

export type PairingStatus = "pending" | "paired" | "rejected";

export interface PairingRequest {
  code: string;
  deviceName: string;
  model: string;
  platform: "android" | "ios";
  appVersion: string;
  status: PairingStatus;
  cid?: string;
  terminalId?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

// ─── client (tenant = one outlet) ────────────────────────────────────────────

export interface ModeFlags {
  dineIn: boolean;
  quick: boolean;
  delivery: boolean;
}

export interface ModeOptions {
  dineIn: { askCovers: boolean; backToTables: boolean };
  quick: { payFirst: boolean };
  delivery: { defaultPrepaid: boolean };
}

export interface Charges {
  packagingPaise: Paise;
  packagingOn: OrderMode[];
  deliveryPaise: Paise;
  /** 0 = feature off. Never added automatically; opt-in per bill (CCPA 2022). */
  serviceChargeBps: Bps;
}

export type ApprovalKey =
  | "voidAfterKot"
  | "discountOverCap"
  | "comp"
  | "cancelBill"
  | "editBill"
  | "reprint"
  | "paidOut"
  | "stockAdjust"
  | "dayClose";

export type Approvals = Record<ApprovalKey, boolean>;

export interface Client extends Meta {
  name: string;
  legalName: string;
  address: string;
  city: string;
  stateName: string;
  /** GST state code, 2 digits, e.g. "33" (Tamil Nadu). */
  stateCode: string;
  phone?: string;
  gstin?: string;
  /** 14-digit FSSAI licence number, printed on bills. */
  fssai: string;
  adminUids: string[];
  status: "active" | "suspended";
  taxMode: TaxMode;
  defaultTaxBps: Bps;
  priceMode: PriceMode;
  rounding: Rounding;
  orderModes: ModeFlags;
  modeOpts: ModeOptions;
  charges: Charges;
  day: { cutoffMin: number };
  /** 0–2 chars A–Z. Invoice series = prefix + terminal code. */
  invoicePrefix: string;
  discountCapBps: Record<StaffRole, Bps>;
  approvals: Approvals;
  receipt: { header: string[]; footer: string[]; showSac: boolean };
  kds: { warnMin: number; lateMin: number };
  stockAutoOff: boolean;
  requirePin: boolean;
  lastZNo: number;
  /** Where UPI payments go; the till shows a QR with the amount when set. */
  upi?: UpiAccount;
}

export type MemberRole = "terminal" | "owner" | "staff";

export interface Member {
  role: MemberRole;
  terminalId?: string;
  active: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PrinterTarget {
  host: string;
  port: number;
  width: 58 | 80;
}

export interface Terminal extends Meta {
  /** One char, unique per client, never reused: "1".."9", "A".."Z". */
  code: string;
  name: string;
  mode: "pos" | "kds";
  authUid: string;
  status: "active" | "revoked";
  /** prefix + code, e.g. "DC1". */
  series: string;
  lastInvoiceFy: Fy;
  lastInvoiceSeq: number;
  lastKot: { d: BizDate; n: number };
  lastOrder: { d: BizDate; n: number };
  lastToken: { d: BizDate; n: number };
  printers: { receipt?: PrinterTarget; kot?: PrinterTarget };
  platform?: "android" | "ios";
  model?: string;
  appVersion?: string;
  lastSeenAtMs?: number;
  lastSeenAt?: unknown;
  clockSkewMs?: number;
  pendingWrites?: number;
  journalRejected?: number;
  pairedBy: string;
  pairedAtMs: number;
  revokedAtMs?: number;
}

export interface Staff extends Meta {
  name: string;
  role: StaffRole;
  phone?: string;
  discountCapBps?: Bps;
  active: boolean;
  /** Phase 2 (salted PBKDF2). Not a security boundary in phase 1. */
  pinHash?: string;
}

export interface Category extends Meta {
  name: string;
  sort: number;
  station: Station;
  active: boolean;
}

export interface Variant {
  id: string;
  name: string;
  pricePaise: Paise;
}

export interface Item extends Meta {
  name: string;
  shortName?: string;
  code?: string;
  categoryId: string;
  sort: number;
  foodType: FoodType;
  pricePaise: Paise;
  variants: Variant[];
  /** null = use the client's default rate. */
  taxBps: Bps | null;
  modes: OrderMode[];
  trackStock: boolean;
  unit: Unit;
  lowAt: number;
  available: boolean;
  active: boolean;
  rev: number;
}

/**
 * An item's photo: a small square JPEG stored inline (base64) at itemPhotos/{itemId}, so it
 * rides the Firestore offline cache to every terminal and needs no Storage bucket (Spark plan).
 * Kept out of the item doc so menu listeners stay light. Removing a photo sets active:false.
 */
export interface ItemPhoto extends Meta {
  itemId: string;
  mime: PhotoMime;
  w: number;
  h: number;
  /** Size of the decoded image in bytes. */
  bytes: number;
  /** Base64 image data, no "data:" prefix. Empty when removed. */
  data: string;
  active: boolean;
}

export type PhotoMime = "image/jpeg" | "image/webp" | "image/png";

export interface StockDoc {
  onHand: number;
  lastPostingKey: string;
  updatedAtMs: number;
}

export interface Floor extends Meta {
  name: string;
  sort: number;
  active: boolean;
}

export interface Table extends Meta {
  floorId: string;
  label: string;
  seats: number;
  sort: number;
  active: boolean;
}

export interface Customer {
  name: string;
  phone: string;
  address?: string;
  landmark?: string;
  orders?: number;
  lastOrderAtMs: number;
  updatedAtMs: number;
}

// ─── orders ─────────────────────────────────────────────────────────────────

export type OrderStatus = "open" | "billed" | "settled" | "cancelled";
export type DeliveryStage = "placed" | "accepted" | "preparing" | "ready" | "out" | "delivered";

export interface Discount {
  kind: "pct" | "flat";
  /** pct: basis points of the base; flat: paise. */
  value: number;
  reason: string;
  by: string;
  approvedBy?: string;
  comp?: boolean;
}

export interface LineVoid {
  qty: number;
  reason: string;
  prepared: boolean;
  by: string;
  approvedBy?: string;
  atMs: number;
}

/**
 * One order line. Lines are append-only per KOT round (a repeat item in a later
 * round is a new line), so two terminals never race on the same line.
 * Invariant: voidedQty ≤ sentQty ≤ qty. Billable qty = qty − voidedQty.
 */
export interface OrderLine {
  lineId: string;
  seq: number;
  itemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  categoryId: string;
  station: Station;
  unitPricePaise: Paise;
  qty: number;
  taxBps: Bps | null;
  note?: string;
  discount?: Discount;
  sentQty: number;
  voidedQty: number;
  voids?: LineVoid[];
  addedBy: string;
  addedAtMs: number;
  kotId?: string;
}

export interface OrderCustomer {
  name?: string;
  phone?: string;
  address?: string;
  landmark?: string;
  gstin?: string;
  stateCode?: string;
}

export interface OrderDelivery {
  stage: DeliveryStage;
  rider?: string;
  pay: "cod" | "prepaid";
  codSettled: boolean;
  stageAtMs?: Partial<Record<DeliveryStage, number>>;
}

export interface OrderCancel {
  reason: string;
  note?: string;
  by: string;
  approvedBy?: string;
  prepared: boolean;
  atMs: number;
}

export interface Order extends Meta {
  outletId: "main";
  orderNo: string;
  token?: number;
  mode: OrderMode;
  businessDate: BizDate;
  /** Owning terminal. Only it may bill offline. */
  terminalId: string;
  status: OrderStatus;
  tableId?: string;
  tableLabel?: string;
  covers?: number;
  customer?: OrderCustomer;
  delivery?: OrderDelivery;
  lines: Record<string, OrderLine>;
  billDiscount?: Discount;
  serviceChargeOptIn: boolean;
  tipPaise: Paise;
  bill?: BillResult;
  /** Immutable once set (rules): prevents two terminals billing one order. */
  invoiceId?: string;
  invoiceNo?: string;
  billModifiedCount: number;
  paidPaise: Paise;
  payModes: PayMode[];
  openedBy: string;
  billedBy?: string;
  settledBy?: string;
  settledAtMs?: number;
  cancel?: OrderCancel;
  flags: { lateAfterClose?: boolean; negativeStock?: boolean; conflict?: boolean };
  kotCount: number;
  rev: number;
  staffId?: string;
}

export type KotKind = "new" | "addon" | "cancel";
export type KotStatus = "new" | "preparing" | "ready" | "served";

export interface KotItem {
  lineId: string;
  itemId: string;
  name: string;
  variantName?: string;
  qty: number;
  note?: string;
}

export interface Kot extends Meta {
  outletId: "main";
  orderId: string;
  orderNo: string;
  kotNo: string;
  businessDate: BizDate;
  terminalId: string;
  kind: KotKind;
  mode: OrderMode;
  /** "T4", "Token 17", "DLV Ravi". */
  where: string;
  station: Station;
  items: KotItem[];
  staffId: string;
  status: KotStatus;
  statusAtMs: Partial<Record<KotStatus, number>>;
  reprints: number;
  reason?: string;
}

// ─── bill ───────────────────────────────────────────────────────────────────

export type DocType = "tax_invoice" | "bill_of_supply";
export type ChargeKind = "packaging" | "delivery" | "service";

export interface BillLineResult {
  lineId: string;
  qty: number;
  grossPaise: Paise;
  itemDiscPaise: Paise;
  billDiscPaise: Paise;
  /** Taxable value (excl. GST) after all discounts. */
  taxablePaise: Paise;
  taxBps: Bps;
  comp: boolean;
}

export interface BillChargeResult {
  kind: ChargeKind;
  /** Amount as entered (inclusive of tax when the client prices inclusively). */
  amountPaise: Paise;
  taxablePaise: Paise;
  taxBps: Bps;
}

export interface TaxBucket {
  bps: Bps;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
}

export interface BillResult {
  lines: BillLineResult[];
  charges: BillChargeResult[];
  taxes: TaxBucket[];
  itemQty: number;
  grossPaise: Paise;
  itemDiscPaise: Paise;
  billDiscPaise: Paise;
  /** Portion of the discounts above that were complimentary. */
  compPaise: Paise;
  /** Taxable value of charges (packaging + delivery + service). */
  chargesPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  roundOffPaise: Paise;
  grandTotalPaise: Paise;
  docType: DocType;
  priceMode: PriceMode;
}

// ─── invoices, payments, cash ───────────────────────────────────────────────

export interface Supplier {
  legalName: string;
  gstin?: string;
  fssai: string;
  address: string;
  stateName: string;
  stateCode: string;
  phone?: string;
}

export interface Buyer {
  name?: string;
  gstin?: string;
  address?: string;
  stateName?: string;
  stateCode?: string;
}

export type InvoiceStatus = "issued" | "cancelled" | "void_unused";

export interface Invoice extends Meta {
  outletId: "main";
  invoiceNo: string;
  series: string;
  fy: Fy;
  seq: number;
  orderId: string;
  orderNo: string;
  terminalId: string;
  /** IST calendar date of issue "YYYY-MM-DD". */
  dateIST: string;
  issuedAtMs: number;
  businessDate: BizDate;
  docType: DocType;
  mode: OrderMode;
  where: string;
  buyer?: Buyer;
  supplier: Supplier;
  bill: BillResult;
  lines: InvoiceLine[];
  modifiedCount: number;
  status: InvoiceStatus;
  cancel?: { reason: string; by: string; approvedBy?: string; atMs: number };
  printedCount: number;
  lastPrintedAtMs?: number;
  staffId: string;
}

/** Printable line snapshot (names frozen at issue). */
export interface InvoiceLine {
  lineId: string;
  name: string;
  variantName?: string;
  qty: number;
  unitPricePaise: Paise;
  amountPaise: Paise;
  taxBps: Bps;
  comp?: boolean;
}

export type PaymentKind = "payment" | "refund";

export interface Payment extends Meta {
  outletId: "main";
  orderId: string;
  invoiceId: string;
  businessDate: BizDate;
  terminalId: string;
  kind: PaymentKind;
  mode: PayMode;
  /** Amount applied to the bill (incl. tip portion), excl. cash change. */
  amountPaise: Paise;
  tenderedPaise?: Paise;
  changePaise?: Paise;
  tipPaise: Paise;
  ref?: string;
  staffId: string;
}

export const EXPENSE_CATEGORIES = [
  "raw_material",
  "vegetables",
  "dairy",
  "meat",
  "beverages",
  "gas_fuel",
  "packaging",
  "cleaning",
  "maintenance",
  "salary_advance",
  "rent",
  "utilities",
  "transport",
  "misc",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type PaidVia = "drawer" | "petty" | "bank" | "upi" | "card";

export interface Expense extends Meta {
  outletId: "main";
  businessDate: BizDate;
  dateMs: number;
  category: ExpenseCategory;
  amountPaise: Paise;
  paidVia: PaidVia;
  /** Set when paid from a terminal's cash drawer (reduces expected cash). */
  drawerTerminalId?: string;
  payee?: string;
  note?: string;
  enteredBy: string;
  approvedBy?: string;
  status: "active" | "void";
  void?: { reason: string; by: string; atMs: number };
  terminalId?: string;
}

export type CashMoveKind = "paid_in" | "drop" | "no_sale";

export interface CashMovement extends Meta {
  outletId: "main";
  businessDate: BizDate;
  terminalId: string;
  kind: CashMoveKind;
  amountPaise: Paise;
  reason: string;
  staffId: string;
  approvedBy?: string;
}

// ─── day, drawers, stats ────────────────────────────────────────────────────

export interface Day {
  status: "open" | "closed";
  openedAtMs: number;
  openedBy: string;
  closedAtMs?: number;
  closedBy?: string;
  approvedBy?: string;
  zNo?: number;
  z?: ZReport;
  carriedForward?: boolean;
  updatedAtMs: number;
}

export interface Drawer {
  terminalId: string;
  businessDate: BizDate;
  openingFloatPaise: Paise;
  openedBy: string;
  openedAtMs: number;
  status: "open" | "closed";
  countedPaise?: Paise;
  denoms?: Record<string, number>;
  expectedPaise?: Paise;
  variancePaise?: Paise;
  note?: string;
  closedBy?: string;
  closedAtMs?: number;
  updatedAtMs: number;
}

export interface NP {
  n: number;
  paise: Paise;
}

export interface CashStats {
  sales: Paise;
  refunds: Paise;
  paidIn: Paise;
  paidOut: Paise;
  drops: Paise;
}

export interface StockStats {
  in: number;
  sold: number;
  rev: number;
  waste: number;
  adj: number;
}

/** Aggregated per client per business day. Maintained only by batched increments. */
export interface DailyStats {
  businessDate: BizDate;
  lastPostingKey: string;
  orders: number;
  covers: number;
  itemQty: number;
  grossPaise: Paise;
  itemDiscPaise: Paise;
  billDiscPaise: Paise;
  compPaise: Paise;
  taxablePaise: Paise;
  chargesPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  tipsPaise: Paise;
  cancelledBills: NP;
  voidItems: NP;
  voidByReason: Record<string, NP>;
  expensesPaise: Paise;
  expByCat: Record<string, Paise>;
  byMode: Record<string, NP>;
  byPay: Record<string, Paise>;
  refundsByPay: Record<string, Paise>;
  byTaxBps: Record<string, { taxable: Paise; cgst: Paise; sgst: Paise }>;
  byItem: Record<string, { qty: number; net: Paise }>;
  byCat: Record<string, { qty: number; net: Paise }>;
  byHour: Record<string, NP>;
  byStaff: Record<string, { n: number; net: Paise; disc: Paise; voids: number }>;
  cash: Record<string, CashStats>;
  stock: Record<string, StockStats>;
  invoices: Record<string, { count: number; cancelled: number }>;
}

/**
 * A partial DailyStats tree where every leaf number is an increment
 * (built only by the delta builders in stats.ts).
 */
export type StatsDelta = { [key: string]: number | StatsDelta | undefined };

export type PostingKind =
  | "kot"
  | "quick"
  | "settle"
  | "line_void"
  | "cancel_bill"
  | "expense"
  | "expense_void"
  | "cash_move"
  | "stock_in"
  | "wastage"
  | "adjust"
  | "count";

export interface Posting {
  kind: PostingKind;
  businessDate: BizDate;
  refId: string;
  stats: StatsDelta;
  /** onHand delta per tracked item. */
  stock?: Record<string, number>;
  staffId: string;
  approverId?: string;
  terminalId?: string;
  createdAtMs: number;
  createdAt?: unknown;
  source: Source;
}

export interface ZReport {
  zNo: number;
  businessDate: BizDate;
  closedAtMs: number;
  orders: number;
  covers: number;
  grossPaise: Paise;
  discountsPaise: Paise;
  compPaise: Paise;
  netPaise: Paise;
  chargesPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  tipsPaise: Paise;
  byPay: Record<string, Paise>;
  refundsByPay: Record<string, Paise>;
  byMode: Record<string, NP>;
  byTaxBps: Record<string, { taxable: Paise; cgst: Paise; sgst: Paise }>;
  cancelledBills: NP;
  voidItems: NP;
  expensesPaise: Paise;
  drawers: Array<{
    terminalId: string;
    floatPaise: Paise;
    cash: CashStats;
    expectedPaise: Paise;
    countedPaise?: Paise;
    variancePaise?: Paise;
  }>;
  invoiceRanges: Array<{ series: string; first: string; last: string; count: number; cancelled: number }>;
}

export interface StockSnapshot {
  businessDate: BizDate;
  items: Record<string, number>;
  counted?: Record<string, number>;
  createdAtMs: number;
}

export interface AuditEntry {
  action: string;
  actor: { kind: "staff" | "platform" | "terminal"; id: string; name?: string };
  approver?: { id: string; name?: string };
  target: { type: string; id: string; label?: string };
  before?: unknown;
  after?: unknown;
  reason?: string;
  terminalId?: string;
  atMs: number;
  createdAt?: unknown;
  source: Source;
}
