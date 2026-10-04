import type { ApprovalKey, Approvals, Bps, Client, StaffRole } from "./types";

/**
 * What each staff role may do in pos-app. Phase 1 uses this for approval prompts and
 * UI gating only (not a security boundary); phase 2 enforces it with PIN login.
 */
export type StaffAction =
  | "order"
  | "kot"
  | "transfer"
  | "merge"
  | "bill"
  | "settle"
  | "discount"
  | "comp"
  | "voidAfterKot"
  | "cancelBill"
  | "editBill"
  | "reprint"
  | "expense"
  | "paidOut"
  | "cashMove"
  | "stockAdjust"
  | "dayOpen"
  | "drawerClose"
  | "dayClose"
  | "xReport"
  | "kds"
  | "viewMoney"
  | "reports";

const CAPTAIN: StaffAction[] = ["order", "kot", "transfer", "merge", "kds", "reprint"];
const CASHIER: StaffAction[] = [...CAPTAIN, "bill", "settle", "discount", "expense", "paidOut", "cashMove", "dayOpen", "drawerClose", "xReport", "viewMoney"];
const MANAGER: StaffAction[] = [...CASHIER, "comp", "voidAfterKot", "cancelBill", "editBill", "stockAdjust", "dayClose", "reports"];

const MATRIX: Record<StaffRole, ReadonlySet<StaffAction>> = {
  owner: new Set<StaffAction>([...MANAGER]),
  manager: new Set(MANAGER),
  cashier: new Set(CASHIER),
  captain: new Set(CAPTAIN),
  kitchen: new Set<StaffAction>(["kds"]),
};

export function can(role: StaffRole, action: StaffAction): boolean {
  return MATRIX[role].has(action);
}

/** Roles that can approve an action on someone else's behalf. */
export function canApprove(role: StaffRole): boolean {
  return role === "owner" || role === "manager";
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  captain: "Captain",
  kitchen: "Kitchen",
};

/** Maximum discount a role may give without approval, in basis points of the base. */
export function capFor(role: StaffRole, client: Pick<Client, "discountCapBps">, override?: Bps): Bps {
  if (role === "owner" || role === "manager") return 10000;
  if (override != null) return override;
  return client.discountCapBps?.[role] ?? 0;
}

const APPROVAL_FOR: Partial<Record<StaffAction, ApprovalKey>> = {
  comp: "comp",
  voidAfterKot: "voidAfterKot",
  cancelBill: "cancelBill",
  editBill: "editBill",
  reprint: "reprint",
  paidOut: "paidOut",
  stockAdjust: "stockAdjust",
  dayClose: "dayClose",
};

/**
 * Does this action need a manager's approval for this role?
 * - Roles lacking the permission always need approval.
 * - Discounts need approval above the role's cap when the client requires it.
 * - Other gated actions need approval when the client's switch is on and the actor can't approve.
 */
export function needsApproval(
  action: StaffAction,
  role: StaffRole,
  client: Pick<Client, "approvals" | "discountCapBps">,
  discountBps?: Bps,
): boolean {
  if (canApprove(role)) return false;
  if (action === "discount") {
    if (discountBps == null) return false;
    return discountBps > capFor(role, client) && (client.approvals?.discountOverCap ?? true);
  }
  if (!can(role, action)) return true;
  const key = APPROVAL_FOR[action];
  return key ? Boolean((client.approvals as Approvals | undefined)?.[key]) : false;
}
