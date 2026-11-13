export const C = Object.freeze({
  width: 800,
  height: 450,
  paddleWidth: 12,
  paddleHeight: 80,
  paddleInset: 20,
  paddleSpeed: 400,
  ballRadius: 8,
  ballStartSpeed: 300,
  ballMaxSpeed: 700,
  maxBounceAngle: Math.PI / 3,
  tickRate: 60,
  broadcastRate: 30,
  winScore: 7,
  interpolationMs: 100,
});
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
