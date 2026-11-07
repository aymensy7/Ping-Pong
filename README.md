# RALLY - two-player WebSocket Pong

A complete Node.js project following the supplied plan: login first, persistent SQLite accounts/sessions, FIFO matchmaking, a server-authoritative game, reconnect grace, rematches, Canvas rendering, interpolation and local paddle prediction. All source, comments and interface text are in English.

## 1. Requirements

- **Node.js 24.15 or newer in the 24.x line**, with npm. Node 18 is not supported: this implementation uses the built-in `node:sqlite` module to avoid an extra native SQLite dependency. This API is release-candidate in Node 24 and may print an experimental warning.
- A modern browser. Use two independent browser profiles, or a regular window and a private window. Two ordinary tabs share a session and cannot represent two different players.
- An Internet connection for the first `npm ci`. Afterwards, play works locally/LAN without Internet access.
