import "server-only";

/*
 * Firestore over REST with the caller's own Firebase ID token: every read and write is checked by
 * firebase/firestore.rules exactly as if the till or admin made it. The server holds no database
 * key (no Admin SDK), so it can only see what the caller can see.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Value =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: Value[] } }
  | { mapValue: { fields?: Record<string, Value> } };

export class FirestoreHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function decode(v: Value): Json {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decode);
  return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]));
}

function encode(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)])) } };
}

function base(): string {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set.");
  // Local demo mode only (never set in production): the Firestore emulator.
  const emu = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;
  const origin = emu ? `http://${emu}:${Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT) || 8080}` : "https://firestore.googleapis.com";
  return `${origin}/v1/projects/${project}/databases/(default)/documents`;
}

/** A Firestore client that acts as the caller (their ID token). Paths come from @px-pos/core `paths`. */
export function firestoreAs(idToken: string) {
  const headers = { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };
  async function call(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(url, { ...init, headers, cache: "no-store" });
    if (res.ok) return res.json();
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new FirestoreHttpError(res.status, body?.error?.message ?? res.statusText);
  }
  return {
    /** One document, or null when it doesn't exist. */
    async get<T>(path: string): Promise<T | null> {
      try {
        const doc = (await call(`${base()}/${path}`)) as { fields?: Record<string, Value> };
        return decode({ mapValue: { fields: doc.fields ?? {} } }) as T;
      } catch (e) {
        if (e instanceof FirestoreHttpError && e.status === 404) return null;
        throw e;
      }
    },
    /** Every document of a collection under `parent` where `field` equals `value`. */
    async where<T>(parent: string, collectionId: string, field: string, value: string | number): Promise<Array<T & { id: string }>> {
      const rows = (await call(`${base()}/${parent}:runQuery`, {
        method: "POST",
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encode(value) } } } }),
      })) as Array<{ document?: { name: string; fields?: Record<string, Value> } }>;
      return rows.filter((r) => r.document).map((r) => ({ ...(decode({ mapValue: { fields: r.document!.fields ?? {} } }) as T), id: r.document!.name.split("/").pop()! }));
    },
    /** Every document of a (small) collection. */
    async list<T>(path: string): Promise<Array<T & { id: string }>> {
      const out: Array<T & { id: string }> = [];
      let token = "";
      do {
        const page = (await call(`${base()}/${path}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`)) as { documents?: Array<{ name: string; fields?: Record<string, Value> }>; nextPageToken?: string };
        for (const d of page.documents ?? []) out.push({ ...(decode({ mapValue: { fields: d.fields ?? {} } }) as T), id: d.name.split("/").pop()! });
        token = page.nextPageToken ?? "";
      } while (token);
      return out;
    },
    /** Create or replace a document. */
    async set(path: string, data: Record<string, unknown>): Promise<void> {
      await call(`${base()}/${path}`, { method: "PATCH", body: JSON.stringify({ fields: (encode(data) as { mapValue: { fields: Record<string, Value> } }).mapValue.fields }) });
    },
  };
}

/** The uid inside an ID token, for the log only (Firestore itself verifies the token on every call). */
export function uidOf(idToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { user_id?: string; sub?: string };
    return payload.user_id ?? payload.sub ?? "unknown";
  } catch {
    return "unknown";
  }
}
