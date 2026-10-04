"use client";

import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { suggestPin } from "@/lib/pin";

/** 4–6 digit till PIN (digits only) with a button that suggests a random one. */
export function PinInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (pin: string) => void; placeholder?: string }) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        placeholder={placeholder}
        className="font-mono tracking-[0.3em]"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={() => onChange(suggestPin())} aria-label="Suggest a PIN">
          <RefreshCw aria-hidden />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** Shown once after a PIN is saved, so it can be handed to the person (it isn't stored readable). */
export function PinReveal({ name, pin }: { name: string; pin: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-sm text-muted-foreground">{name} signs in on the till with</p>
      <p className="font-mono text-4xl font-semibold tracking-[0.4em] tabular-nums">
        <span aria-hidden>{pin}</span>
        {/* Read digit by digit ("4 8 2 1"), not as a number. */}
        <span className="sr-only">PIN {pin.split("").join(" ")}</span>
      </p>
      <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(pin).then(() => toast.success("PIN copied"))}>
        <Copy data-icon="inline-start" aria-hidden />
        Copy PIN
      </Button>
      <p className="text-sm text-muted-foreground">Give it to {name.split(" ")[0]} privately. It can&apos;t be shown again, only changed.</p>
    </div>
  );
}
