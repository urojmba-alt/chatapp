import { Router } from "express";
import db from "../lib/db.js";

const router = Router();

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
  const { rows } = await db.query("SELECT is_admin FROM users WHERE id=$1", [req.session.userId]);
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
      messages: parseInt

git pull && cat > src/routes/admin.js << 'EOF'
import { Router } from "express";
import db from "../lib/db.js";

const router = Router();

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
  const { rows } = await db.query("SELECT is_admin FROM users WHERE id=$1", [req.session.userId]);
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
      "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT 100"
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
      "SELECT m.id, m.room_id, m.sender_name, m.content, m.role, m.created_at FROM messages m ORDER BY m.created_at DESC LIMIT 200"
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

export default router;
