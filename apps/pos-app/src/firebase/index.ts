import { getApp } from "@react-native-firebase/app";
import { connectAuthEmulator, getAuth } from "@react-native-firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from "@react-native-firebase/firestore";

type Firestore = ReturnType<typeof getFirestore>;

let db: Firestore | undefined;
let authReady = false;

/**
 * Dev only: a host running the Firebase emulators (Firestore :8080, Auth :9099), baked in at
 * bundle time, e.g. 10.0.2.2 for the Android emulator. Production builds never set it.
 */
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST;

/**
 * Native Firestore with the on-disk cache: queued writes survive an app kill and replay
 * when the tablet reconnects (the JS SDK can't do this on React Native).
 * Must run before any other Firestore call.
 */
export function getDb(): Firestore {
  if (db) return db;
  try {
    db = initializeFirestore(getApp(), {
      persistence: true,
      cacheSizeBytes: 256 * 1024 * 1024,
      serverTimestampBehavior: "estimate",
      ignoreUndefinedProperties: true,
    });
    if (emulatorHost) connectFirestoreEmulator(db, emulatorHost, 8080);
  } catch {
    db = getFirestore();
  }
  return db;
}

export function getAuthInstance(): ReturnType<typeof getAuth> {
  const auth = getAuth();
  if (emulatorHost && !authReady) {
    authReady = true;
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`);
  }
  return auth;
}

export type { Firestore };
