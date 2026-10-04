import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { formatINR, paths, phone10, type Customer } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { ModeGate } from "@/components/pos/mode-gate";
import { useLiveDoc } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { usePaired } from "@/state/session";

export default function DeliveryScreen() {
  return (
    <ModeGate mode="delivery">
      <NewDelivery />
    </ModeGate>
  );
}

/** New delivery: customer first (repeat numbers autofill from the cache), then the register. */
function NewDelivery() {
  const { cid, client } = usePaired();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [pay, setPay] = useState<"cod" | "prepaid">(client.modeOpts.delivery.defaultPrepaid ? "prepaid" : "cod");
  const p10 = phone10(phone);
  const saved = useLiveDoc<Customer>(p10 ? paths.customer(cid, p10) : null).data;
  const canStart = Boolean(p10 && name.trim() && address.trim());

  function applySaved() {
    if (!saved) return;
    setName(saved.name ?? "");
    setAddress(saved.address ?? "");
    setLandmark(saved.landmark ?? "");
  }

  function start() {
    if (!p10) return;
    const q: Record<string, string> = { mode: "delivery", phone: p10, name: name.trim(), address: address.trim(), pay, ...(landmark.trim() ? { landmark: landmark.trim() } : {}) };
    router.push({ pathname: "/till/order", params: q });
  }

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-4 md:max-w-2xl">
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">Phone</Text>
          <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} placeholder="10-digit mobile" autoFocus accessibilityLabel="Customer phone" />
        </View>
        {saved && saved.name !== name ? (
          <Pressable onPress={applySaved} accessibilityRole="button" className="flex-row items-center justify-between rounded-xl border border-primary/60 bg-primary/10 p-3 active:bg-primary/20">
            <View className="flex-1">
              <Text className="font-semibold">Returning customer · {saved.name}</Text>
              <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                {saved.orders ?? 0} orders{saved.address ? ` · ${saved.address}` : ""}
              </Text>
            </View>
            <Text className="font-semibold text-primary">Use</Text>
          </Pressable>
        ) : null}
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">Name</Text>
          <Input value={name} onChangeText={setName} placeholder="Customer name" autoCapitalize="words" accessibilityLabel="Customer name" />
        </View>
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">Address</Text>
          <Input value={address} onChangeText={setAddress} placeholder="House, street, area" multiline className="min-h-20 py-2" textAlignVertical="top" accessibilityLabel="Delivery address" />
        </View>
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">Landmark (optional)</Text>
          <Input value={landmark} onChangeText={setLandmark} placeholder="Near…" accessibilityLabel="Landmark" />
        </View>
        <View className="flex-row gap-2">
          {(["cod", "prepaid"] as const).map((m) => (
            <Pressable key={m} onPress={() => setPay(m)} accessibilityRole="radio" accessibilityState={{ selected: pay === m }} className={cn("h-14 flex-1 items-center justify-center rounded-xl border", pay === m ? "border-primary bg-primary/15" : "border-border bg-card")}>
              <Text className="text-lg font-semibold">{m === "cod" ? "Cash on delivery" : "Prepaid"}</Text>
            </Pressable>
          ))}
        </View>
        {client.charges.deliveryPaise ? <Text className="text-sm text-muted-foreground">Delivery charge {formatINR(client.charges.deliveryPaise, { decimals: "auto" })} is added to the bill.</Text> : null}
        <Button size="xl" disabled={!canStart} onPress={start}>
          <Text>Take order</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
