import { getMembers } from "../lib/redis.js";
import { Router } from "express";
import db from "../lib/db.js";

const router = Router();

async function requireAdmin(req, res, next) {
  let userId = req.session?.userId;
  
  if (!userId) {
    const token = req.headers["x-auth-token"] || req.query.token;
    if (token) {
      try {
        const { rows } = await db.query(
          "SELECT u.id, u.is_admin FROM users u JOIN sessions_tokens s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>NOW()",
          [token]
        );
        if (rows.length) {
          userId = rows[0].id;
          if (!rows[0].is_admin) return res.status(403).json({ error: "Admin only" });
          return next();
        }
      } catch(e) {}
    }
    return res.status(401).json({ error: "Login required" });
  }

  const { rows } = await db.query("SELECT is_admin FROM users WHERE id=$1", [userId]);
  if (!rows.length || !rows[0].is_admin) return res.status(403).json({ error: "Admin only" });
  next();
}

router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const [users, messages, rooms] = await Promise.all([
      db.query("SELECT COUNT(*) FROM users"),
      db.query("SELECT COUNT(*) FROM messages"),
      db.query("SELECT COUNT(*) FROM rooms"),
    ]);
    res.json({
      users: parseInt(users.rows[0].count),
      messages: parseInt(messages.rows[0].count),
      rooms: parseInt(rooms.rows[0].count),
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get("/users", requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, username, is_admin, created_at, (SELECT COUNT(*) FROM messages WHERE user_id=users.id) as msg_count FROM users ORDER BY created_at DESC LIMIT 100"
    );
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete("/users/:id", requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM users WHERE id=$1 AND is_admin=FALSE", [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get("/messages", requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, room_id, sender_name, content, role, created_at FROM messages ORDER BY created_at DESC LIMIT 200"
    );
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete("/messages/:id", requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM messages WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


router.get("/online", requireAdmin, async (req, res) => {
  try {
    const { rows: rooms } = await db.query("SELECT id, name, icon FROM rooms");
    const result = [];
    for (const room of rooms) {
      const members = await getMembers(room.id);
      if (members.length > 0) {
        result.push({ room_id: room.id, room_name: room.name, room_icon: room.icon, members });
      }
    }
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});


router.get("/connected", requireAdmin, async (req, res) => {
  try {
    const io = req.app.get("io");
    const sockets = await io.fetchSockets();
    res.json({ count: sockets.length });
  } catch(e) { res.status(500).json({ count: 0 }); }
});

export default router;
