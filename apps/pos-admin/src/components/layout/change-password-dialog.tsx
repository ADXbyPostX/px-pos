"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { FormDialog } from "@/components/shared/form-dialog";
import { Field } from "@/components/shared/field";
import { authMessage, useAuth } from "@/components/providers/firebase-provider";

function PasswordInput({ id, value, onChange, autoComplete, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput id={id} type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} required />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** Change the signed-in account's password (current password required, as Firebase asks). */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { changePassword, user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    if (pending) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    onOpenChange(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!current) return setError("Enter your current password.");
    if (next.length < 8) return setError("Use at least 8 characters for the new password.");
    if (next === current) return setError("The new password must be different from the current one.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setPending(true);
    try {
      await changePassword(current, next);
      toast.success("Password changed. Use the new one next time you sign in.");
      setPending(false);
      close();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(code === "auth/invalid-credential" || code === "auth/wrong-password" ? "Your current password is incorrect." : authMessage(err));
      setPending(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Change password"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="password-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Change password
          </Button>
        </>
      }
    >
      <form id="password-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {/* Lets password managers file the new password under the right account. */}
        <input type="email" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
        <Field label="Current password" htmlFor="pw-current">
          <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="New password" htmlFor="pw-new">
          <PasswordInput id="pw-new" value={next} onChange={setNext} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm">
          <PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
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
