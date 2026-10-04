"use client";

import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseConfigured, getAuthInstance } from "@/lib/firebase/client";

type Status = "loading" | "ready" | "error" | "unconfigured";

interface AuthCtx {
  status: Status;
  user: User | null;
  uid: string | null;
  isAnonymous: boolean;
  error: string | null;
  /** Keep this browser's identity (same uid) and add email + password so it works anywhere. */
  linkEmail: (email: string, password: string, name?: string) => Promise<void>;
  /** Sign in on a new browser with a linked email. Replaces the anonymous identity here. */
  signInEmail: (email: string, password: string) => Promise<void>;
  /** Only for email-linked accounts; the browser falls back to a fresh anonymous identity. */
  signOut: () => Promise<void>;
  /** The account signs in with email + password (so its password can be changed). */
  hasPassword: boolean;
  /** Re-check the current password (Firebase requires a recent sign-in), then set the new one. */
  changePassword: (current: string, next: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = use(Ctx);
  if (!v) throw new Error("useAuth must be used inside <FirebaseProvider>");
  return v;
}

/**
 * Phase 1 has no login screens: every browser gets an anonymous Firebase identity and
 * access comes from Firestore documents (platformUsers/{uid}). We wait for the persisted
 * session to load before signing in anonymously, so a returning browser keeps its uid.
 */
export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Status; user: User | null; error: string | null }>({ status: firebaseConfigured ? "loading" : "unconfigured", user: null, error: null });

  useEffect(() => {
    if (!firebaseConfigured) return;
    const auth = getAuthInstance();
    let unsub = () => {};
    let cancelled = false;
    (async () => {
      try {
        await auth.authStateReady();
        if (!auth.currentUser) await signInAnonymously(auth);
        if (cancelled) return;
        unsub = onAuthStateChanged(auth, async (user) => {
          if (!user) {
            // Signed out of an email account: continue as a fresh anonymous identity.
            try {
              await signInAnonymously(auth);
            } catch (e) {
              setState({ status: "error", user: null, error: (e as Error).message });
            }
            return;
          }
          setState({ status: "ready", user, error: null });
        });
      } catch (e) {
        const code = (e as { code?: string }).code;
        const message =
          code === "auth/admin-restricted-operation" || code === "auth/operation-not-allowed"
            ? "Anonymous sign-in is disabled for this Firebase project."
            : code === "auth/network-request-failed"
              ? "You're offline. Connect to the internet to start."
              : (e as Error).message;
        if (!cancelled) setState({ status: "error", user: null, error: message });
      }
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const linkEmail = useCallback(async (email: string, password: string, name?: string) => {
    const auth = getAuthInstance();
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in yet");
    const cred = EmailAuthProvider.credential(email.trim(), password);
    const res = await linkWithCredential(user, cred);
    if (name) await updateProfile(res.user, { displayName: name });
    setState({ status: "ready", user: res.user, error: null });
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    const res = await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password);
    setState({ status: "ready", user: res.user, error: null });
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(getAuthInstance());
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    const user = getAuthInstance().currentUser;
    if (!user?.email) throw new Error("This account has no email sign-in.");
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    await updatePassword(user, next);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      status: state.status,
      user: state.user,
      uid: state.user?.uid ?? null,
      isAnonymous: state.user?.isAnonymous ?? true,
      error: state.error,
      linkEmail,
      signInEmail,
      signOut,
      hasPassword: state.user?.providerData.some((p) => p.providerId === "password") ?? false,
      changePassword,
    }),
    [state, linkEmail, signInEmail, signOut, changePassword],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

/** Friendly text for Firebase Auth errors on the setup screen. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
    case "auth/credential-already-in-use":
      return "That email is already linked to another account. Sign in with it instead.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/weak-password":
      return "Use at least 8 characters for the password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/network-request-failed":
      return "You're offline.";
    case "auth/provider-already-linked":
      return "This account already has an email.";
    default:
      return e instanceof Error ? e.message : "Something went wrong.";
  }
}
