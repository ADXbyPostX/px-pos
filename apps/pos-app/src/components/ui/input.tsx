import * as React from "react";
import { TextInput } from "react-native";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="hsl(240 5% 45%)"
      className={cn("min-h-12 rounded-lg border border-input bg-background px-3 text-lg text-foreground", props.editable === false && "opacity-50", className)}
      {...props}
    />
  );
}
