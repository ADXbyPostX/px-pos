import { useSafeAreaFrame } from "react-native-safe-area-context";

/**
 * Layout size class from the safe-area frame (not Dimensions — under the New Architecture
 * Dimensions can go stale after rotation/fold; lesson from adx-mobile).
 *  phone < 600dp ≤ tabletP < 960dp ≤ tabletL
 */
export type SizeClass = "phone" | "tabletP" | "tabletL";

export function useBreakpoint(): { size: SizeClass; width: number; height: number } {
  const { width, height } = useSafeAreaFrame();
  const size: SizeClass = Math.min(width, height) < 600 ? "phone" : width >= 960 ? "tabletL" : "tabletP";
  return { size, width, height };
}
