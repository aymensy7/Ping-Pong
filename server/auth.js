import { Router } from "express";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { csrfGuard, authLimit, fail } from "./middleware.js";
const save = (s) =>
  new Promise((resolve, reject) => s.save((e) => (e ? reject(e) : resolve())));
const rotate = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
export async function authRouter({ db, allowed, ttl, onRevoke }) {
  const router = Router(),
    limit = authLimit(),
    guard = csrfGuard(allowed);
  const dummy = await argon2.hash(randomBytes(32).toString("hex"), {
    type: argon2.argon2id,
  });
  router.get("/csrf", async (req, res) => {
    req.session.csrf ??= randomBytes(32).toString("hex");
    req.session.expiresAt ??= Date.now() + 600000;
    await save(req.session);
    res.json({ csrf: req.session.csrf });
  });
  router.get("/me", (req, res) => {
    if (!req.session.user || req.session.expiresAt <= Date.now())
      return fail(res, 401, "AUTH", "Please log in.");
    res.json({ user: req.session.user });
  });
  for (const mode of ["register", "login"])
    router.post("/" + mode, limit, guard, async (req, res) => {
      const { username, password } = req.body || {};
      if (
        typeof username !== "string" ||
        !/^\w{3,20}$/.test(username) ||
        typeof password !== "string" ||
        [...password].length < 15 ||
        [...password].length > 128
      )
        return fail(
          res,
          400,
          "VALIDATION",
          "Use a username of 3-20 letters, digits or underscores and a password of 15-128 characters.",
        );
      const normalized = username.toLowerCase();
      let row = db
        .prepare("SELECT * FROM users WHERE username_normalized=?")
        .get(normalized);
      if (mode === "register") {
        const hash = await argon2.hash(password, { type: argon2.argon2id });
        try {
          const result = db
            .prepare(
              "INSERT INTO users(username,username_normalized,password_hash,created_at) VALUES(?,?,?,?)",
            )
            .run(username, normalized, hash, Date.now());
          row = { id: Number(result.lastInsertRowid), username };
        } catch (e) {
          if (String(e.message).includes("UNIQUE"))
            return fail(res, 409, "USERNAME", "This username is unavailable.");
          throw e;
        }
      } else if (
        !(await argon2.verify(row?.password_hash || dummy, password)) ||
        !row
      )
        return fail(res, 401, "CREDENTIALS", "Invalid username or password.");
      const old = req.sessionID;
      onRevoke(old, "session_rotated");
      await rotate(req);
      req.session.user = { id: row.id, username: row.username };
      req.session.csrf = randomBytes(32).toString("hex");
      req.session.expiresAt = Date.now() + ttl;
      req.session.cookie.maxAge = ttl;
      await save(req.session);
      res
        .status(mode === "register" ? 201 : 200)
        .json({ user: req.session.user, csrf: req.session.csrf });
    });
  router.post("/logout", guard, (req, res, next) => {
    const sid = req.sessionID;
    req.session.destroy((e) => {
      if (e) return next(e);
      onRevoke(sid, "logout");
      res.clearCookie("rally.sid", { path: "/" }).sendStatus(204);
    });
  });
  return router;
}
