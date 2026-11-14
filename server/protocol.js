export function parse(raw, isBinary = false) {
  if (isBinary || raw.length > 1024)
    throw Error("Message must be JSON text, at most 1 KB.");
  const m = JSON.parse(raw.toString());
  if (
    !m ||
    typeof m !== "object" ||
    Array.isArray(m) ||
    !["join", "input", "ready", "rematch", "leave", "ping"].includes(m.t)
  )
    throw Error("Unknown message type.");
  if (
    m.t === "input" &&
    (!Number.isSafeInteger(m.seq) || m.seq < 1 || ![-1, 0, 1].includes(m.dir))
  )
    throw Error("Invalid input.");
  if (m.t === "ping" && (!Number.isFinite(m.ts) || m.ts < 0))
    throw Error("Invalid timestamp.");
  return m;
}
export function send(ws, t, data = {}) {
  if (ws?.readyState === 1) {
    if (ws.bufferedAmount > 65536) {
      ws.close(1013, "Slow connection");
      return;
    }
    ws.send(JSON.stringify({ t, ...data }));
  }
}
