import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/lib/utils";
import { Text } from "./text";

/**
 * Modal panel: centred card on tablets, bottom sheet on phones. Tap outside to dismiss
 * (unless `locked`). Used for variant pickers, reasons, approvals, discounts.
 */
export function Sheet({ open, onClose, title, children, footer, wide = false, locked = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; locked?: boolean }) {
  const insets = useSafeAreaInsets();
  // Bottom sheet below md (edge-to-edge: keep the last row clear of the system nav bar).
  const bottomSheet = useWindowDimensions().width < 768;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => !locked && onClose()} statusBarTranslucent supportedOrientations={["landscape", "portrait"]}>
      {/* Edge-to-edge Android no longer resizes the window for the keyboard: pad on both platforms. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Pressable className="flex-1 items-center justify-end bg-black/70 md:justify-center" onPress={() => !locked && onClose()} accessibilityLabel="Close">
          <Pressable className={cn("max-h-[92%] w-full rounded-t-2xl border border-border bg-popover md:rounded-2xl", wide ? "md:max-w-3xl" : "md:max-w-lg")} style={bottomSheet ? { paddingBottom: insets.bottom } : undefined} onPress={() => {}}>
            <View className="border-b border-border px-5 py-4">
              <Text className="text-xl font-semibold" accessibilityRole="header">
                {title}
              </Text>
            </View>
            <View className="px-5 py-4">{children}</View>
            {footer ? <View className="flex-row justify-end gap-3 border-t border-border px-5 py-4">{footer}</View> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
