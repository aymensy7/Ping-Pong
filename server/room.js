import { Game } from "./game.js";
import { send } from "./protocol.js";
export class Room {
  constructor(id, left, right, options = {}) {
    this.id = id;
    this.players = { left, right };
    this.options = options;
    this.game = new Game(options);
    this.votes = new Set();
    this.disconnected = new Map();
    for (const side of ["left", "right"]) {
      this.players[side].room = this;
      this.players[side].side = side;
      this.matched(this.players[side]);
    }
    this.broadcast("countdown", { seconds: 3 });
  }
  broadcast(t, p = {}) {
    for (const s of ["left", "right"])
      if (this.players[s].room === this) send(this.players[s].ws, t, p);
  }
  matched(p) {
    send(p.ws, "matched", {
      roomId: this.id,
      side: p.side,
      opponentName:
        this.players[p.side === "left" ? "right" : "left"].user.username,
      rematchPossible: true,
    });
  }
  snapshot() {
    this.broadcast("state", {
      ...this.game.snapshot(),
      ackSeq: {
        left: this.game.paddles.left.seq,
        right: this.game.paddles.right.seq,
      },
    });
  }
  update(dt) {
    for (const e of this.game.update(dt)) {
      const { t, ...p } = e;
      this.broadcast(t, p);
    }
    for (const [side, deadline] of this.disconnected)
      if (Date.now() >= deadline) {
        this.forfeit(side, "reconnect_timeout");
        break;
      }
  }
  disconnect(p) {
    if (this.game.status === "finished") return;
    this.resumeStatus ??= this.game.status;
    this.game.status = "paused";
    for (const side of ["left", "right"]) this.game.paddles[side].dir = 0;
    this.disconnected.set(p.side, Date.now() + (this.options.graceMs ?? 10000));
    this.broadcast("opponent_left", {
      reason: "reconnecting",
      seconds: (this.options.graceMs ?? 10000) / 1000,
    });
    this.snapshot();
  }
  reconnect(p) {
    this.disconnected.delete(p.side);
    this.game.paddles[p.side].seq = 0;
    this.game.paddles[p.side].dir = 0;
    this.matched(p);
    if (this.disconnected.size === 0 && this.game.status === "paused") {
      this.game.status = this.resumeStatus || "playing";
      this.resumeStatus = null;
      this.broadcast("resumed");
    }
    this.snapshot();
  }
  forfeit(side, reason) {
    if (this.game.status === "finished") return;
    this.disconnected.clear();
    this.game.status = "finished";
    this.game.winner = side === "left" ? "right" : "left";
    this.resumeStatus = null;
    this.broadcast("opponent_left", { reason, rematchPossible: false });
    this.broadcast("gameover", {
      winner: this.game.winner,
      score: { ...this.game.score },
      reason,
      rematchPossible: false,
    });
    this.snapshot();
  }
  rematch(p) {
    if (this.game.status !== "finished") return;
    const other = this.players[p.side === "left" ? "right" : "left"];
    if (other.room !== this || !other.ws || other.ws.readyState !== 1) {
      send(p.ws, "error", {
        code: "OPPONENT_GONE",
        message: "Opponent has left. Return to the lobby.",
      });
      return;
    }
    this.votes.add(p.user.id);
    this.broadcast("rematch_vote", { count: this.votes.size });
    if (this.votes.size === 2) {
      this.votes.clear();
      const seq = {
        left: this.game.paddles.left.seq,
        right: this.game.paddles.right.seq,
      };
      this.game = new Game(this.options);
      for (const s of ["left", "right"]) this.game.paddles[s].seq = seq[s];
      this.broadcast("countdown", { seconds: 3 });
      this.snapshot();
    }
  }
}
