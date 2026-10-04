"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { bootstrapPlan, paths } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/shared/field";
import { SecureAccountDialog } from "@/components/layout/secure-account-dialog";
import { authMessage, useAuth } from "@/components/providers/firebase-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { applyPlan, firestoreMessage } from "@/lib/firebase/apply-plan";
import { useDoc } from "@/lib/firebase/hooks";
import { brand } from "@/lib/brand";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5 rounded-xl border bg-card p-6">{children}</div>;
}

function SignInWithEmail() {
  const { signInEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signInEmail(email, password);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Email" htmlFor="si-email">
        <Input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="si-password">
        <Input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || !email || !password}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <KeyRound data-icon="inline-start" aria-hidden />}
        Sign in
      </Button>
    </form>
  );
}

/**
 * First run + access screen (phase 1 has no login gate):
 *  - nobody has claimed the panel → "Claim super admin" (one time, enforced by rules)
 *  - this browser has access → continue (and optionally link an email)
 *  - otherwise → show this browser's ID for the super admin, or sign in with a linked email.
 */
export function SetupView() {
  const auth = useAuth();
  const { status, principal } = usePrincipal();
  const router = useRouter();
  const bootstrap = useDoc<{ uid: string }>(auth.uid ? paths.bootstrap() : null);
  const [name, setName] = useState("Mandy");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [secureOpen, setSecureOpen] = useState(false);

  async function claim(e: FormEvent) {
    e.preventDefault();
    if (!auth.uid) return;
    setClaimError(null);
    setClaiming(true);
    try {
      await applyPlan(bootstrapPlan({ uid: auth.uid, name: name.trim() || "Super admin", nowMs: Date.now() }));
      toast.success("You're the super admin of this panel.");
      setSecureOpen(true);
    } catch (err) {
      setClaimError(firestoreMessage(err));
    } finally {
      setClaiming(false);
    }
  }

  const loading = auth.status === "loading" || status === "loading" || (auth.uid && bootstrap.status === "loading");

  return (
    <main className="relative isolate flex flex-1 items-center justify-center px-4 py-12">
      <div aria-hidden className="bg-ember" />
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Image src={brand.main.src} alt={brand.main.alt} width={brand.main.width} height={brand.main.height} priority unoptimized className="mx-auto h-9 w-auto" />
        <h1 className="sr-only">PX POS setup</h1>

        {auth.status === "unconfigured" ? (
          <Card>
            <p className="text-sm text-muted-foreground">Firebase isn&apos;t configured for this build. Fill NEXT_PUBLIC_FIREBASE_* in apps/pos-admin/.env.local and restart.</p>
          </Card>
        ) : auth.status === "error" ? (
          <Card>
            <p role="alert" className="text-sm text-destructive">
              {auth.error}
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </Card>
        ) : loading ? (
          <Card>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking this browser&apos;s access…
            </div>
          </Card>
        ) : principal ? (
          <Card>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{principal.name}</p>
                <p className="text-sm text-muted-foreground">{principal.role === "superadmin" ? "Super admin" : "Admin"}{auth.user?.email ? ` · ${auth.user.email}` : ""}</p>
              </div>
            </div>
            {auth.isAnonymous ? (
              <Button variant="outline" onClick={() => setSecureOpen(true)}>
                <KeyRound data-icon="inline-start" aria-hidden />
                Secure this account with an email
              </Button>
            ) : null}
            <Button onClick={() => router.push("/")}>
              Open panel
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          </Card>
        ) : !bootstrap.data ? (
          <Card>
            <form onSubmit={claim} className="flex flex-col gap-4" noValidate>
              <Field label="Your name" htmlFor="claim-name">
                <Input id="claim-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
              {claimError ? (
                <p role="alert" className="text-sm text-destructive">
                  {claimError}
                </p>
              ) : null}
              <Button type="submit" disabled={claiming}>
                {claiming ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <ShieldCheck data-icon="inline-start" aria-hidden />}
                Claim super admin
              </Button>
            </form>
          </Card>
        ) : (
          <>
            <Card>
              <p className="text-sm text-muted-foreground">This browser doesn&apos;t have access yet. Send this ID to the super admin, or sign in with your email below.</p>
              <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{auth.uid}</code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy browser ID"
                  onClick={() => auth.uid && navigator.clipboard?.writeText(auth.uid).then(() => toast.success("Copied"))}
                >
                  <Copy aria-hidden />
                </Button>
              </div>
            </Card>
            <Card>
              <SignInWithEmail />
            </Card>
          </>
        )}
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="underline-offset-4 hover:underline">
            {brand.company} · {brand.name}
          </Link>
        </p>
      </div>
      <SecureAccountDialog
        open={secureOpen}
        onOpenChange={(o) => {
          setSecureOpen(o);
          if (!o && principal) router.push("/");
        }}
        defaultName={principal?.name ?? name}
      />
    </main>
  );
}
