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

// Get all conversations
router.get("/", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const { rows } = await db.query(`
      SELECT DISTINCT ON (other_id)
        other_id,
        other_username,
        last_message,
        last_at,
        unread_count
      FROM (
        SELECT 
          CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END as other_id,
          CASE WHEN sender_id=$1 THEN (SELECT username FROM users WHERE id=receiver_id) ELSE (SELECT username FROM users WHERE id=sender_id) END as other_username,
          content as last_message,
          created_at as last_at,
          (SELECT COUNT(*) FROM direct_messages WHERE receiver_id=$1 AND sender_id=CASE WHEN dm.sender_id=$1 THEN dm.receiver_id ELSE dm.sender_id END AND read=false) as unread_count
        FROM direct_messages dm
        WHERE sender_id=$1 OR receiver_id=$1
        ORDER BY created_at DESC
      ) t
      ORDER BY other_id, last_at DESC
    `, [user.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get conversation with a user
router.get("/:userId", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const { rows } = await db.query(`
      SELECT dm.*, 
        s.username as sender_username,
        r.username as receiver_username
      FROM direct_messages dm
      JOIN users s ON s.id = dm.sender_id
      JOIN users r ON r.id = dm.receiver_id
      WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
      ORDER BY created_at ASC LIMIT 50
    `, [user.id, req.params.userId]);
    // Mark as read
    await db.query("UPDATE direct_messages SET read=true WHERE receiver_id=$1 AND sender_id=$2", [user.id, req.params.userId]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send a DM
router.post("/:userId", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Message required" });
    const { rows } = await db.query(
      "INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES ($1,$2,$3) RETURNING *",
      [user.id, req.params.userId, content.trim().slice(0, 2000)]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export default router;
