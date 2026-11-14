import session from "express-session";
// Express-session owns signing, rotation and cookie parsing. This is its SQLite Store adapter.
export class SQLiteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }
  get(sid, cb) {
    try {
      const row = this.db
        .prepare("SELECT data FROM sessions WHERE sid=? AND expires>?")
        .get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) {
      cb(e);
    }
  }
  set(sid, data, cb = () => {}) {
    try {
      const expiry = Number(data.expiresAt || Date.now() + 600000);
      this.db
        .prepare(
          "INSERT OR REPLACE INTO sessions(sid,data,expires) VALUES(?,?,?)",
        )
        .run(sid, JSON.stringify(data), expiry);
      cb();
    } catch (e) {
      cb(e);
    }
  }
  destroy(sid, cb = () => {}) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
      cb();
    } catch (e) {
      cb(e);
    }
  }
  prune() {
    this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
  }
}
export { session };
