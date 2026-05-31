import { Router } from "express";
import db from "../lib/db.js";

const router = Router();

async function getUser(req) {
  const token = req.headers["x-auth-token"];
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

router.get("/", async (req, res) => {
  try {
    const { room, limit=20, offset=0 } = req.query;
    const q = room
      ? "SELECT id,user_id,username,room_id,title,LEFT(content,300) as excerpt,created_at FROM posts WHERE room_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
      : "SELECT id,user_id,username,room_id,title,LEFT(content,300) as excerpt,created_at FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2";
    const params = room ? [room, limit, offset] : [limit, offset];
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM posts WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Post not found" });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const { title, content, room_id } = req.body;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: "Title and content required" });
    if (title.length > 200) return res.status(400).json({ error: "Title too long" });
    if (content.length > 10000) return res.status(400).json({ error: "Content too long (max 10000 chars)" });
    const { rows } = await db.query(
      "INSERT INTO posts (user_id,username,room_id,title,content) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [user.id, user.username, room_id||null, title.trim(), content.trim()]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/:id", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    await db.query("DELETE FROM posts WHERE id=$1 AND user_id=$2", [req.params.id, user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export default router;
