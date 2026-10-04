import { getApp } from "@react-native-firebase/app";
import { getAuth } from "@react-native-firebase/auth";
import { getFirestore, initializeFirestore } from "@react-native-firebase/firestore";

type Firestore = ReturnType<typeof getFirestore>;

let db: Firestore | undefined;

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
  } catch {
    db = getFirestore();
  }
  return db;
}

export function getAuthInstance(): ReturnType<typeof getAuth> {
  return getAuth();
}

export type { Firestore };
