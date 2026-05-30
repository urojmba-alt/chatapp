import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error",   err => console.error("Redis error:", err.message));
redis.on("connect", ()  => console.log("✓ Redis connected"));

/* ── Room presence ─────────────────────────────────────────────────────────── */

export async function addMember(roomId, socketId, user) {
  await redis.hset(`room:${roomId}:members`, socketId, JSON.stringify(user));
  await redis.expire(`room:${roomId}:members`, 86_400);
}

export async function removeMember(roomId, socketId) {
  await redis.hdel(`room:${roomId}:members`, socketId);
}

export async function getMembers(roomId) {
  const raw = await redis.hgetall(`room:${roomId}:members`);
  if (!raw) return [];
  return Object.values(raw).map(v => JSON.parse(v));
}

export async function getMemberCount(roomId) {
  return redis.hlen(`room:${roomId}:members`);
}

/* ── Per-room AI rate limit ─────────────────────────────────────────────────── */

export async function acquireAiSlot(roomId, windowMs) {
  const key = `ratelimit:ai:${roomId}`;
  const set = await redis.set(key, 1, "PX", windowMs, "NX");
  return set === "OK"; // true = allowed, false = rate-limited
}

export default redis;
