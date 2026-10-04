"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const HEADER_ACTIONS_ID = "header-actions";

const noop = () => () => {};
const getTarget = () => document.getElementById(HEADER_ACTIONS_ID);

/** Renders page toolbars and primary actions into the top bar. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(noop, getTarget, () => null);
  return target ? createPortal(children, target) : null;
}
