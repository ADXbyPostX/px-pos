"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { FormDialog } from "@/components/shared/form-dialog";
import { Field } from "@/components/shared/field";
import { authMessage, useAuth } from "@/components/providers/firebase-provider";

/**
 * Link email + password to this browser's identity (same uid, no data moves), so the
 * account can be opened from any browser via /setup → "Sign in with email".
 */
export function SecureAccountDialog({ open, onOpenChange, defaultName }: { open: boolean; onOpenChange: (o: boolean) => void; defaultName?: string }) {
  const { linkEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Use at least 8 characters for the password.");
    setPending(true);
    try {
      await linkEmail(email, password, defaultName);
      toast.success("Account secured. You can now sign in with this email anywhere.");
      onOpenChange(false);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title="Secure this account"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="secure-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <form id="secure-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Email" htmlFor="secure-email">
          <Input id="secure-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="secure-password">
          <InputGroup>
            <InputGroupInput id="secure-password" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </FormDialog>
  );
}
