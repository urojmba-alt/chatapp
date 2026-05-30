/**
 * Express middleware – requires an authenticated session.
 * Used by routes/rooms.js for protected endpoints.
 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/**
 * Socket.io middleware – requires an authenticated session.
 * Used by server.js to gate WebSocket connections.
 */
export function requireAuthSocket(socket, next) {
  const session = socket.request.session;
  if (!session?.userId) {
    return next(new Error("Not authenticated"));
  }
  socket.userId = session.userId;
  socket.username = session.username;
  socket.color = session.color;
  next();
}

