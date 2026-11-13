import { C, clamp } from "../shared/constants.js";
export class Game {
  constructor({ winScore = C.winScore, random = Math.random } = {}) {
    this.random = random;
    this.winScore = winScore;
    this.tick = 0;
    this.status = "countdown";
    this.remaining = 3;
    this.score = { left: 0, right: 0 };
    this.winner = null;
    this.serving = random() < 0.5 ? "left" : "right";
    this.paddles = {
      left: { y: 185, dir: 0, seq: 0 },
      right: { y: 185, dir: 0, seq: 0 },
    };
    this.resetBall();
  }
  resetBall() {
    this.ball = { x: C.width / 2, y: C.height / 2, vx: 0, vy: 0 };
  }
  input(side, dir, seq) {
    const p = this.paddles[side];
    if (seq > p.seq) {
      p.dir = dir;
      p.seq = seq;
    }
  }
  serve() {
    const a = ((this.random() * 2 - 1) * Math.PI) / 6;
    this.ball = {
      x: 400,
      y: 225,
      vx: (this.serving === "left" ? -1 : 1) * C.ballStartSpeed * Math.cos(a),
      vy: C.ballStartSpeed * Math.sin(a),
    };
    this.status = "playing";
  }
  update(dt) {
    const events = [];
    if (this.status === "paused" || this.status === "finished") return events;
    this.tick++;
    if (this.status === "countdown") {
      this.remaining -= dt;
      if (this.remaining <= 0) this.serve();
      return events;
    }
    const oldY = {};
    for (const s of ["left", "right"]) {
      const p = this.paddles[s];
      oldY[s] = p.y;
      p.y = clamp(
        p.y + p.dir * C.paddleSpeed * dt,
        0,
        C.height - C.paddleHeight,
      );
    }
    // Swept front-face collisions; split at each wall/paddle contact, preserving residual time.
    let rest = dt,
      elapsed = 0;
    const b = this.ball,
      r = C.ballRadius;
    for (let pass = 0; pass < 8 && rest > 1e-9; pass++) {
      let t = rest,
        kind = null,
        side = null;
      const candidate = (time, k, s = null) => {
        if (time >= -1e-9 && time <= t) {
          t = Math.max(0, time);
          kind = k;
          side = s;
        }
      };
      if (b.vy < 0) candidate((r - b.y) / b.vy, "wall");
      else if (b.vy > 0) candidate((C.height - r - b.y) / b.vy, "wall");
      const s = b.vx < 0 ? "left" : "right",
        face =
          s === "left"
            ? C.paddleInset + C.paddleWidth + r
            : C.width - C.paddleInset - C.paddleWidth - r;
      const hit = (face - b.x) / b.vx;
      if (hit >= 0 && hit <= rest) {
        const y = b.y + b.vy * hit,
          p = this.paddles[s],
          py = oldY[s] + ((p.y - oldY[s]) * (elapsed + hit)) / dt;
        if (y >= py - r && y <= py + C.paddleHeight + r)
          candidate(hit, "paddle", s);
      }
      if (b.vx < 0) candidate((-r - b.x) / b.vx, "goal", "right");
      else if (b.vx > 0) candidate((C.width + r - b.x) / b.vx, "goal", "left");
      b.x += b.vx * t;
      b.y += b.vy * t;
      rest -= t;
      elapsed += t;
      if (kind === "wall") {
        b.vy = -b.vy;
      } else if (kind === "paddle") {
        const p = this.paddles[side],
          py = oldY[side] + ((p.y - oldY[side]) * elapsed) / dt;
        const angle =
          clamp((b.y - py - C.paddleHeight / 2) / (C.paddleHeight / 2), -1, 1) *
          C.maxBounceAngle;
        const speed = Math.min(C.ballMaxSpeed, Math.hypot(b.vx, b.vy) * 1.05);
        b.vx = (side === "left" ? 1 : -1) * speed * Math.cos(angle);
        b.vy = speed * Math.sin(angle);
        b.x += side === "left" ? 1e-6 : -1e-6;
      } else if (kind === "goal") {
        this.score[side]++;
        events.push({ t: "point", scorer: side, score: { ...this.score } });
        if (this.score[side] >= this.winScore) {
          this.status = "finished";
          this.winner = side;
          events.push({
            t: "gameover",
            winner: side,
            score: { ...this.score },
            reason: "score",
          });
        } else {
          this.serving = side === "left" ? "right" : "left";
          this.status = "countdown";
          this.remaining = 1.5;
          this.resetBall();
        }
        break;
      } else break;
    }
    return events;
  }
  snapshot() {
    return {
      tick: this.tick,
      status: this.status,
      remaining: this.remaining,
      ball: { ...this.ball },
      paddles: structuredClone(this.paddles),
      score: { ...this.score },
      winner: this.winner,
      serving: this.serving,
    };
  }
}
