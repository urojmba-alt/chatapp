import { Router } from "express";
import db from "../lib/db.js";

const router = Router();

async function getUser(req) {
  const token = req.headers["x-auth-token"] || req.query.token;
  if (token) {
    const { rows } = await db.query(
      "SELECT u.id, u.username FROM users u JOIN sessions_tokens s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>NOW()",
      [token]
    );
    if (rows.length) return rows[0];
  }
  if (req.session?.userId) return { id: req.session.userId, username: req.session.username };
  return null;
}

// Follow a user
router.post("/:id", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    if (user.id === req.params.id) return res.status(400).json({ error: "Cannot follow yourself" });
    await db.query(
      "INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [user.id, req.params.id]
    );
    res.json({ ok: true, following: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Unfollow a user
router.delete("/:id", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    await db.query("DELETE FROM follows WHERE follower_id=$1 AND following_id=$2", [user.id, req.params.id]);
    res.json({ ok: true, following: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get my following list
router.get("/following", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const { rows } = await db.query(
      "SELECT u.id, u.username FROM users u JOIN follows f ON f.following_id=u.id WHERE f.follower_id=$1 ORDER BY f.created_at DESC",
      [user.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get user profile
router.get("/profile/:username", async (req, res) => {
  try {
    const me = await getUser(req);
    const { rows } = await db.query(
      "SELECT id, username, created_at, age, location, bio, looking_for, gender FROM users WHERE username=$1",
      [req.params.username]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const u = rows[0];
    const [msgCount, postCount, isFollowing] = await Promise.all([
      db.query("SELECT COUNT(*) FROM messages WHERE user_id=$1 AND role='user'", [u.id]),
      db.query("SELECT COUNT(*) FROM posts WHERE user_id=$1", [u.id]),
      me ? db.query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2", [me.id, u.id]) : { rows: [] }
    ]);
    res.json({
      id: u.id,
      username: u.username,
      created_at: u.created_at,
      age: u.age,
      location: u.location,
      bio: u.bio,
      looking_for: u.looking_for,
      gender: u.gender,
      msg_count: parseInt(msgCount.rows[0].count),
      post_count: parseInt(postCount.rows[0].count),
      is_following: isFollowing.rows.length > 0,
      is_me: me?.id === u.id
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export default router;
