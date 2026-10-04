import * as React from "react";
import { Text as RNText } from "react-native";
import { cn } from "@/lib/utils";

/** Lets a parent (e.g. Button) set the text style of its children (React Native Reusables pattern). */
export const TextClassContext = React.createContext<string | undefined>(undefined);

export function Text({ className, ...props }: React.ComponentProps<typeof RNText>) {
  const inherited = React.useContext(TextClassContext);
  return <RNText className={cn("text-base text-foreground", inherited, className)} {...props} />;
}
