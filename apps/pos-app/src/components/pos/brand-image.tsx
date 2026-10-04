import { Image } from "react-native";
import { brand } from "@/lib/brand";

export function BrandImage({ kind = "main", width }: { kind?: "main" | "short" | "mark"; width: number }) {
  const b = brand[kind];
  return <Image source={b.source} style={{ width, height: width / b.aspect }} resizeMode="contain" accessibilityLabel={b.alt} />;
}
