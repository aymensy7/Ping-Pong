import { Room } from "./room.js";
import { send } from "./protocol.js";
import { randomUUID } from "node:crypto";
export class Lobby {
  constructor(options = {}) {
    this.options = options;
    this.players = new Map();
    this.queue = [];
    this.rooms = new Map();
  }
  connect(user, ws, sid) {
    let p = this.players.get(user.id);
    if (p) {
      p.ws = ws;
      p.sid = sid;
      if (p.room) p.room.reconnect(p);
    } else {
      p = { user, ws, sid, room: null };
      this.players.set(user.id, p);
    }
    return p;
  }
  join(p) {
    if (p.room || this.queue.includes(p)) return;
    this.queue.push(p);
    send(p.ws, "queued", { position: this.queue.length });
    while (this.queue.length >= 2) {
      const [a, b] = this.queue.splice(0, 2),
        r = new Room(randomUUID(), a, b, this.options);
      this.rooms.set(r.id, r);
    }
  }
  dequeue(p) {
    this.queue = this.queue.filter((x) => x !== p);
  }
  leave(p, reason = "leave") {
    this.dequeue(p);
    if (p.room) {
      const r = p.room;
      r.forfeit(p.side, reason);
      r.votes.clear();
      p.room = null;
      if (!Object.values(r.players).some((player) => player.room === r))
        this.rooms.delete(r.id);
    }
    send(p.ws, "lobby");
  }
  disconnect(p, permanent = false) {
    this.dequeue(p);
    p.ws = null;
    if (permanent) {
      this.leave(p, "logout");
      this.players.delete(p.user.id);
    } else if (p.room && p.room.game.status !== "finished")
      p.room.disconnect(p);
    else {
      if (p.room) this.leave(p, "disconnect");
      this.players.delete(p.user.id);
    }
  }
  update(dt) {
    for (const r of this.rooms.values()) r.update(dt);
    for (const [id, p] of this.players)
      if (!p.ws && (!p.room || p.room.game.status === "finished")) {
        if (p.room) this.leave(p, "disconnect");
        this.players.delete(id);
      }
  }
  broadcast() {
    for (const r of this.rooms.values()) r.snapshot();
  }
}
