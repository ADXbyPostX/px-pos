/** What every server action returns: the saved thing, or a message the form can show. */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = <T = never>(error: string): ActionResult<T> => ({ ok: false, error });
