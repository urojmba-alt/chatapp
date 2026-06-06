import { Router } from "express";
import bcrypt from "bcryptjs";
import db from "../lib/db.js";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const PALETTE = [
  { bg: "#E6F1FB", fg: "#185FA5" }, { bg: "#E1F5EE", fg: "#0F6E56" },
  { bg: "#FAECE7", fg: "#993C1D" }, { bg: "#FBEAF0", fg: "#993556" },
  { bg: "#FAEEDA", fg: "#854F0B" }, { bg: "#EAF3DE", fg: "#3B6D11" },
  { bg: "#EEEDFE", fg: "#534AB7" }, { bg: "#FCEBEB", fg: "#A32D2D" },
  { bg: "#F1EFE8", fg: "#5F5E5A" },
];
function randColor() { return PALETTE[Math.floor(Math.random() * PALETTE.length)]; }
async function saveToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions_tokens (token, user_id) VALUES ($1,$2)", [token, userId]);
  return token;
}
async function getUserByToken(token) {
  if (!token) return null;
  try {
    const { rows } = await db.query(
      "SELECT u.id, u.username, u.color_bg, u.color_fg FROM users u JOIN sessions_tokens s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>NOW()",
      [token]
    );
    if (!rows.length) return null;
    const u = rows[0];
    return { id: u.id, username: u.username, color: { bg: u.color_bg, fg: u.color_fg } };
  } catch(e) { return null; }
}

router.post("/register", async (req, res) => {
  const { username, password, email } = req.body ?? {};
  if (!username?.trim() || !password) return res.status(400).json({ error: "Username and password required" });
  if (username.trim().length < 2 || username.trim().length > 20) return res.status(400).json({ error: "Username must be 2-20 characters" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    const hash = await bcrypt.hash(password, 12);
    const c = randColor();
    const { rows } = await db.query(
      "INSERT INTO users (username, email, password_hash, color_bg, color_fg) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, color_bg, color_fg",
      [username.trim(), email?.trim()||null, hash, c.bg, c.fg]
    );
    const u = rows[0];
    const token = await saveToken(u.id);
    req.session.userId = u.id; req.session.username = u.username;
    req.session.color = { bg: u.color_bg, fg: u.color_fg };
    res.json({ id: u.id, username: u.username, color: req.session.color, token });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Username already taken" });
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password, email } = req.body ?? {};
  if (!username?.trim() || !password) return res.status(400).json({ error: "Username and password required" });
  try {
    const { rows } = await db.query(
      "SELECT id, username, password_hash, color_bg, color_fg FROM users WHERE username=$1", [username.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });
    const u = rows[0];
    if (!await bcrypt.compare(password, u.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
    const token = await saveToken(u.id);
    req.session.userId = u.id; req.session.username = u.username;
    req.session.color = { bg: u.color_bg, fg: u.color_fg };
    res.json({ id: u.id, username: u.username, color: req.session.color, token });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.post("/logout", async (req, res) => {
  const token = req.headers["x-auth-token"];
  if (token) await db.query("DELETE FROM sessions_tokens WHERE token=$1", [token]).catch(()=>{});
  req.session.destroy(() => {});
  res.clearCookie("connect.sid");
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const token = req.headers["x-auth-token"];
  const u = await getUserByToken(token);
  if (u) return res.json({ ...u, token });
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  res.json({ id: req.session.userId, username: req.session.username, color: req.session.color });
});

// Delete account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id=$1', [req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export { getUserByToken };
export default router;
