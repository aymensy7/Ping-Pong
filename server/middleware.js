import { timingSafeEqual } from "node:crypto";
export const fail = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });
export function sameOrigin(req, allowed) {
  return allowed.includes(req.headers.origin);
}
export function csrfGuard(allowed) {
  return (req, res, next) => {
    const expected = req.session.csrf,
      received = req.get("x-csrf-token");
    if (
      !sameOrigin(req, allowed) ||
      !expected ||
      typeof received !== "string" ||
      Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
    )
      return fail(res, 403, "CSRF", "Reload the page and try again.");
    next();
  };
}
export function authLimit() {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(),
      key = req.ip;
    for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    let v = hits.get(key);
    if (!v) {
      v = { count: 0, until: now + 60000 };
      hits.set(key, v);
    }
    if (++v.count > 15)
      return fail(
        res,
        429,
        "RATE_LIMIT",
        "Too many attempts. Try again in one minute.",
      );
    next();
  };
}
