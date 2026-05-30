import db from "../lib/db.js";

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

export async function requireAuthSocket(socket, next) {
  const session = socket.request.session;
  if (session?.userId) {
    socket.userId = session.userId;
    socket.username = session.username;
    socket.color = session.color;
    return next();
  }
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const { rows } = await db.query(
        "SELECT u.id, u.username, u.color_bg, u.color_fg FROM users u JOIN sessions_tokens s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>NOW()",
        [token]
      );
      if (rows.length) {
        const u = rows[0];
        socket.userId = u.id;
        socket.username = u.username;
        socket.color = { bg: u.color_bg, fg: u.color_fg };
        return next();
      }
    } catch(e) { console.error("Socket token auth:", e.message); }
  }
  return next(new Error("Unauthorized"));
}
