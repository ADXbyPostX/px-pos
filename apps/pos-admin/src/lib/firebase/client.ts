import "client-only";
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, inMemoryPersistence, initializeAuth, signOut, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

/**
 * Firebase web SDK for pos-admin. Everything is lazy and browser-only: call these from
 * effects or event handlers, never at module scope of a server-rendered file.
 * Security lives in firebase/firestore.rules (the admin talks to Firestore directly,
 * like the pos-app terminals do).
 */
const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) throw new Error("Firebase is not configured: fill NEXT_PUBLIC_FIREBASE_* in apps/pos-admin/.env.local");
  // The default app only: a named helper app (see createLogin) must never be picked up here.
  app ??= getApps().find((a) => a.name === "[DEFAULT]") ?? initializeApp(config);
  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  const a = getFirebaseApp();
  try {
    db = initializeFirestore(a, {
      ignoreUndefinedProperties: true,
      // IndexedDB cache shared across tabs in the browser; memory during any server evaluation.
      localCache: typeof window === "undefined" ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialised (hot reload) — reuse the existing instance.
    db = getFirestore(a);
  }
  return db;
}

export function getAuthInstance(): Auth {
  auth ??= getAuth(getFirebaseApp());
  return auth;
}

let makerAuth: Auth | undefined;

/**
 * Create an email + password sign-in for someone else (e.g. a new admin) and return its uid.
 * Runs on a separate, in-memory Firebase app so the signed-in super admin stays signed in.
 */
export async function createLogin(email: string, password: string): Promise<string> {
  if (!makerAuth) {
    const maker = getApps().find((a) => a.name === "login-maker") ?? initializeApp(config, "login-maker");
    try {
      makerAuth = initializeAuth(maker, { persistence: inMemoryPersistence });
    } catch {
      makerAuth = getAuth(maker); // already initialised (hot reload)
    }
  }
  const cred = await createUserWithEmailAndPassword(makerAuth, email.trim(), password);
  const uid = cred.user.uid;
  await signOut(makerAuth);
  return uid;
}
