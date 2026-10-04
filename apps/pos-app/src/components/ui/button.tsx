import * as React from "react";
import { Pressable } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { TextClassContext } from "./text";

/** Touch-first buttons: 48dp default, 56dp for primary actions (size="lg"). Flat, no shadows. */
const buttonVariants = cva("flex-row items-center justify-center gap-2 rounded-lg active:opacity-80", {
  variants: {
    variant: {
      default: "bg-primary",
      secondary: "bg-secondary",
      outline: "border border-border bg-background",
      ghost: "",
      destructive: "border border-destructive/50 bg-destructive/15",
      success: "bg-success",
    },
    size: {
      default: "min-h-12 px-4",
      sm: "min-h-10 px-3",
      lg: "min-h-14 px-5",
      xl: "min-h-16 px-6",
      icon: "h-12 w-12",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

const buttonTextVariants = cva("font-semibold", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      outline: "text-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive",
      success: "text-black",
    },
    size: { default: "text-base", sm: "text-sm", lg: "text-lg", xl: "text-xl", icon: "text-base" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = React.ComponentProps<typeof Pressable> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, disabled, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        role="button"
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size }), disabled && "opacity-40", className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { buttonVariants, buttonTextVariants };
