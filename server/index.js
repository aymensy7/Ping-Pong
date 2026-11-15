import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";
import { openDatabase } from "./database.js";
import { session, SQLiteStore } from "./session.js";
import { authRouter } from "./auth.js";
import { sameOrigin } from "./middleware.js";
import { Lobby } from "./lobby.js";
import { parse, send } from "./protocol.js";
import { C } from "../shared/constants.js";
export async function createApp(options = {}) {
  const port = options.port ?? Number(process.env.PORT || 3000),
    production = process.env.NODE_ENV === "production";
  const allowed =
    options.origins ??
    (
      process.env.ALLOWED_ORIGINS ||
      `http://localhost:${port},http://127.0.0.1:${port}`
    )
      .split(",")
      .map((s) => s.trim());
  const secret = options.secret ?? process.env.SESSION_SECRET;
  if (
    production &&
    (!secret ||
      secret.length < 32 ||
      allowed.some((s) => !s.startsWith("https://")))
  )
    throw Error(
      "Production needs SESSION_SECRET (32+ characters) and HTTPS ALLOWED_ORIGINS.",
    );
  const ttl = options.ttl ?? Number(process.env.SESSION_TTL_MS || 86400000),
    db = openDatabase(
      options.dbPath ?? process.env.DB_PATH ?? resolve("data/rally.sqlite"),
    ),
    store = new SQLiteStore(db);
  const app = express(),
    server = createServer(app),
    wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024,
      perMessageDeflate: false,
    });
  const lobby = new Lobby({
    winScore: options.winScore ?? Number(process.env.WIN_SCORE || 7),
    graceMs: options.graceMs ?? 10000,
    random: options.random,
  });
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  const sessionMiddleware = session({
    name: "rally.sid",
    secret: secret || randomBytes(48).toString("hex"),
    resave: false,
    saveUninitialized: false,
    store,
    rolling: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      path: "/",
      maxAge: ttl,
    },
  });
  app.use(sessionMiddleware);
  const revoke = (sid, reason) => {
    for (const p of lobby.players.values())
      if (p.sid === sid) {
        const ws = p.ws;
        lobby.disconnect(p, true);
        ws?.close(4001, reason);
      }
  };
  app.use(
    "/api/auth",
    await authRouter({ db, allowed, ttl, onRevoke: revoke }),
  );
  app.use(
    "/shared",
    express.static(fileURLToPath(new URL("../shared", import.meta.url))),
  );
  app.use(express.static(fileURLToPath(new URL("../client", import.meta.url))));
  app.get(["/login", "/register", "/lobby", "/play"], (req, res) =>
    res.sendFile(
      fileURLToPath(new URL("../client/index.html", import.meta.url)),
    ),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res
      .status(err.status || 500)
      .json({
        error: {
          code: "REQUEST",
          message:
            err.status === 400
              ? "Invalid JSON."
              : "Request failed. Please try again.",
        },
      });
  });
  server.on("upgrade", (req, socket, head) => {
    const reject = (status) => {
      socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    if (req.url !== "/ws") return reject("404 Not Found");
    if (!sameOrigin(req, allowed)) return reject("403 Forbidden");
    sessionMiddleware(req, {}, () => {
      const s = req.session;
      if (!s?.user || s.expiresAt <= Date.now())
        return reject("401 Unauthorized");
      const existing = lobby.players.get(s.user.id);
      if (existing?.ws && existing.ws.readyState < 2)
        return reject("409 Conflict");
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    });
  });
  wss.on("connection", (ws, req) => {
    ws.on("error", () => {});
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
      ws.lastPong = Date.now();
    });
    ws.lastPong = Date.now();
    send(ws, "welcome", {
      playerId: req.session.user.id,
      user: req.session.user,
      config: { ...C, winScore: lobby.options.winScore },
    });
    const p = lobby.connect(req.session.user, ws, req.sessionID);
    let count = 0,
      window = Date.now();
    const expiry = setTimeout(
      () => {
        revoke(req.sessionID, "session_expired");
      },
      Math.min(2147483647, Math.max(1, req.session.expiresAt - Date.now())),
    );
    ws.on("message", (raw, binary) => {
      const active = db
        .prepare("SELECT expires FROM sessions WHERE sid=?")
        .get(p.sid);
      if (!active || active.expires <= Date.now()) {
        revoke(p.sid, "session_expired");
        return;
      }
      if (Date.now() - window >= 1000) {
        window = Date.now();
        count = 0;
      }
      if (++count > 120) {
        ws.close(1008, "Message rate exceeded");
        return;
      }
      try {
        const m = parse(raw, binary);
        switch (m.t) {
          case "join":
            lobby.join(p);
            break;
          case "input":
            if (p.room && p.room.game.status === "playing")
              p.room.game.input(p.side, m.dir, m.seq);
            break;
          case "leave":
            lobby.leave(p);
            break;
          case "rematch":
            p.room?.rematch(p);
            break;
          case "ping":
            send(ws, "pong", { ts: m.ts });
            break;
          case "ready":
            break;
        }
      } catch {
        send(ws, "error", { code: "PROTOCOL", message: "Invalid message." });
      }
    });
    ws.on("close", () => {
      clearTimeout(expiry);
      if (p.ws === ws) lobby.disconnect(p);
    });
  });
  let last = performance.now(),
    acc = 0,
    ticks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= 1 / C.tickRate) {
      lobby.update(1 / C.tickRate);
      acc -= 1 / C.tickRate;
      if (++ticks % 2 === 0) lobby.broadcast();
    }
  }, 8);
  const heart = setInterval(() => {
    store.prune();
    for (const ws of wss.clients) {
      if (Date.now() - ws.lastPong >= 20000) {
        ws.terminate();
        continue;
      }
      ws.ping();
    }
  }, 10000);
  async function close() {
    clearInterval(timer);
    clearInterval(heart);
    for (const ws of wss.clients) {
      send(ws, "shutdown", { message: "Server is restarting." });
      ws.terminate();
    }
    await new Promise((r) => wss.close(r));
    await new Promise((r) => server.close(r));
    db.close();
  }
  return {
    app,
    server,
    wss,
    lobby,
    db,
    close,
    listen: () => new Promise((r) => server.listen(port, "0.0.0.0", r)),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf("--port");
  const runtime = await createApp(
    portIndex >= 0 ? { port: Number(process.argv[portIndex + 1]) } : {},
  );
  await runtime.listen();
  console.log(
    `RALLY running on http://localhost:${runtime.server.address().port}`,
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, async () => {
      await runtime.close();
      process.exit(0);
    });
}
