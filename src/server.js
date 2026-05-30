import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import session from "express-session";
import RedisStore from "connect-redis";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import redis from "./lib/redis.js";
import authRouter from "./routes/auth.js";
import roomsRouter from "./routes/rooms.js";
import { requireAuthSocket } from "./middleware/auth.js";
import { registerSocketHandlers } from "./rooms/socket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Session middleware (shared between Express and Socket.io) ─────────────── */
const sessionMiddleware = session({
  store: new RedisStore({ client: redis, prefix: "sess:" }),
  secret: process.env.SESSION_SECRET || "dev-secret-CHANGE-IN-PROD",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});

/* ── Express ─────────────────────────────────────────────────────────────────── */
const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json());
app.use(sessionMiddleware);

// Rate limits
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth",
  rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: "Too many auth attempts, slow down." } }),
  authRouter
);
app.use("/api/rooms", roomsRouter);

// Serve frontend
app.use(express.static(join(__dirname, "../public")));
app.get("*", (_, res) => res.sendFile(join(__dirname, "../public/index.html")));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

/* ── Socket.io ──────────────────────────────────────────────────────────────── */
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: ["https://lonelinesskill.com", "http://localhost:3000"], credentials: true },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

// Give Socket.io access to the session
io.engine.use(sessionMiddleware);
io.use(requireAuthSocket);
registerSocketHandlers(io);

/* ── Start ───────────────────────────────────────────────────────────────────── */
const PORT = parseInt(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  console.log(`✓ Ready → http://localhost:${PORT}  [${process.env.NODE_ENV ?? "development"}]`);
});

process.on("unhandledRejection", err => console.error("UnhandledRejection:", err));
