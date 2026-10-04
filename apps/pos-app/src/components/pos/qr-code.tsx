import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { qrRows } from "@/lib/qr";

const QUIET = 3;

/** A crisp QR code: dark modules on white with a quiet zone, drawn as one SVG path. */
export function QrCode({ value, size, accessibilityLabel }: { value: string; size: number; accessibilityLabel?: string }) {
  const { n, d } = useMemo(() => {
    const rows = qrRows(value, "M");
    let path = "";
    // One rectangle per run of dark modules: fewer edges, so no hairline seams between modules.
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; ) {
        if (row[x] !== "1") {
          x++;
          continue;
        }
        let run = 1;
        while (row[x + run] === "1") run++;
        path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
        x += run;
      }
    });
    return { n: rows.length + QUIET * 2, d: path };
  }, [value]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
        <Rect x={0} y={0} width={n} height={n} fill="#ffffff" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}
