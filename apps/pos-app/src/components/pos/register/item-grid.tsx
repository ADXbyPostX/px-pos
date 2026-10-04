import { useMemo, useState } from "react";
import { FlatList, Image, Pressable, View, type LayoutChangeEvent } from "react-native";
import { Search, X } from "lucide-react-native";
import { formatINR, stockLevel, type Item, type OrderMode, type Variant } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import type { WithId } from "@/hooks/use-live";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { FoodMark } from "../food-mark";

type It = WithId<Item>;

/**
 * Item tiles: tap adds one; items with sizes open the size picker; long-press adds with a note.
 * With photos on, a dish's photo fills its tile under a dark name band; every tile in the
 * grid then shares the taller height so rows stay even.
 */
export function ItemGrid({
  items,
  categoryId,
  mode,
  stock,
  qtyByItem,
  onAdd,
  photos,
  showPhotos = true,
  minTile = 150,
}: {
  items: It[];
  categoryId: string;
  mode: OrderMode;
  stock: Map<string, number>;
  qtyByItem: Map<string, number>;
  onAdd: (item: It, variant?: Variant, qty?: number, note?: string) => void;
  photos?: Map<string, string>;
  showPhotos?: boolean;
  minTile?: number;
}) {
  const [q, setQ] = useState("");
  const [width, setWidth] = useState(0);
  const [picking, setPicking] = useState<It | null>(null);
  const [noting, setNoting] = useState<{ item: It; variant?: Variant } | null>(null);
  const [note, setNote] = useState("");
  const cols = Math.max(2, Math.floor(width / minTile) || 2);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => i.modes.includes(mode) && (categoryId === "all" || i.categoryId === categoryId) && (!needle || i.name.toLowerCase().includes(needle) || (i.code ?? "").toLowerCase() === needle));
  }, [items, categoryId, mode, q]);

  const out = (i: It) => !i.available || (i.trackStock && (stock.get(i.id) ?? 0) <= 0);
  const tall = showPhotos && Boolean(photos?.size);

  return (
    <View className="flex-1" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View className="flex-row items-center gap-2 border-b border-border px-3 py-2">
        <Search color={colors.muted} size={20} />
        <Input value={q} onChangeText={setQ} placeholder="Search dish or code" className="flex-1 border-0 bg-transparent" returnKeyType="search" accessibilityLabel="Search items" />
        {q ? (
          <Pressable onPress={() => setQ("")} accessibilityLabel="Clear search" className="h-11 w-11 items-center justify-center">
            <X color={colors.muted} size={20} />
          </Pressable>
        ) : null}
      </View>
      {width > 0 ? (
        <FlatList
          key={cols}
          data={visible}
          numColumns={cols}
          keyExtractor={(i) => i.id}
          contentContainerClassName="p-2"
          // While searching, the first tap must add the dish — not just close the keyboard.
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text className="p-6 text-center text-muted-foreground">{q ? "No dishes match" : "No dishes in this category"}</Text>}
          renderItem={({ item: i }) => {
            const isOut = out(i);
            const onHand = stock.get(i.id) ?? 0;
            const level = i.trackStock ? stockLevel(onHand, i.lowAt) : "ok";
            const inTicket = qtyByItem.get(i.id) ?? 0;
            const photo = tall ? photos?.get(i.id) : undefined;
            const price = `${i.variants.length ? "from " : ""}${formatINR(i.pricePaise, { decimals: "auto" })}`;
            const badge = isOut ? (
              <Text className="text-xs font-bold text-primary">OUT</Text>
            ) : inTicket ? (
              <View className="min-w-7 items-center rounded-full bg-primary px-2 py-0.5">
                <Text className="text-sm font-bold text-white">{inTicket}</Text>
              </View>
            ) : level === "low" ? (
              <Text className="text-xs text-warning">{onHand} left</Text>
            ) : null;
            return (
              // The Pressable is the card itself: `active:` on a plain child View makes NativeWind
              // attach touch handlers to it, which swallows the tap before the Pressable sees it.
              <View style={{ width: `${100 / cols}%` }} className="p-1">
                <Pressable
                  disabled={isOut}
                  onPress={() => (i.variants.length ? setPicking(i) : onAdd(i))}
                  onLongPress={() => {
                    if (i.variants.length) setPicking(i);
                    else {
                      setNote("");
                      setNoting({ item: i });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${i.name}, ${formatINR(i.pricePaise, { decimals: "auto" })}${isOut ? ", out of stock" : ""}${inTicket ? `, ${inTicket} in ticket` : ""}`}
                  className={cn(
                    "overflow-hidden rounded-xl border bg-card",
                    tall ? "h-40" : "h-28",
                    photo ? "justify-end active:opacity-80" : "justify-between p-3 active:bg-accent",
                    inTicket ? "border-primary" : "border-border",
                    inTicket && photo && "border-2",
                    isOut && "opacity-40",
                  )}
                >
                  {photo ? (
                    <>
                      <Image source={{ uri: photo }} resizeMode="cover" className="absolute inset-0 h-full w-full" accessibilityIgnoresInvertColors />
                      <View className="absolute left-2 right-2 top-2 flex-row items-start justify-between">
                        <View className="rounded bg-white p-0.5">
                          <FoodMark type={i.foodType} />
                        </View>
                        {badge}
                      </View>
                      <View className="gap-0.5 bg-black/75 px-2.5 py-1.5">
                        <Text numberOfLines={2} android_hyphenationFrequency="normal" className="text-sm font-semibold leading-4 text-white">
                          {i.name}
                        </Text>
                        <Text className="text-xs text-white/80">{price}</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View className="flex-row items-start gap-2">
                        <FoodMark type={i.foodType} className="mt-1" />
                        <Text numberOfLines={tall ? 3 : 2} android_hyphenationFrequency="normal" className="flex-1 text-base font-semibold leading-5">
                          {i.name}
                        </Text>
                      </View>
                      <View className="flex-row items-end justify-between">
                        <Text className="text-muted-foreground">{price}</Text>
                        {badge}
                      </View>
                    </>
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      ) : null}

      <Sheet open={Boolean(picking)} onClose={() => setPicking(null)} title={picking?.name ?? ""}>
        <View className="flex-row flex-wrap gap-3">
          {picking?.variants.map((v) => (
            <Button
              key={v.id}
              variant="outline"
              size="xl"
              className="min-w-40 grow"
              onPress={() => {
                onAdd(picking, v);
                setPicking(null);
              }}
            >
              <View className="items-center">
                <Text className="text-lg font-semibold">{v.name}</Text>
                <Text className="text-muted-foreground">{formatINR(v.pricePaise, { decimals: "auto" })}</Text>
              </View>
            </Button>
          ))}
        </View>
      </Sheet>

      <Sheet
        open={Boolean(noting)}
        onClose={() => setNoting(null)}
        title={`Add ${noting?.item.name ?? ""} with a note`}
        footer={
          <>
            <Button variant="ghost" onPress={() => setNoting(null)}>
              <Text>Cancel</Text>
            </Button>
            <Button
              onPress={() => {
                if (noting) onAdd(noting.item, noting.variant, 1, note.trim() || undefined);
                setNoting(null);
              }}
            >
              <Text>Add</Text>
            </Button>
          </>
        }
      >
        <View className="gap-3">
          <Input value={note} onChangeText={setNote} placeholder="Less spicy, no onion…" autoFocus maxLength={80} />
          <View className="flex-row flex-wrap gap-2">
            {["Less spicy", "Extra spicy", "No onion", "No garlic", "Jain", "Parcel"].map((p) => (
              <Button key={p} size="sm" variant="secondary" onPress={() => setNote((n) => (n ? `${n}, ${p}` : p))}>
                <Text>{p}</Text>
              </Button>
            ))}
          </View>
        </View>
      </Sheet>
    </View>
  );
}
