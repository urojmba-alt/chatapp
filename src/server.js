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
import adminRouter from "./routes/admin.js";
import postsRouter from "./routes/posts.js";
import { requireAuthSocket } from "./middleware/auth.js";
import { registerSocketHandlers } from "./rooms/socket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED = [
  "https://lonelinesskill.com",
  "https://www.lonelinesskill.com",
  "http://localhost:3000",
  "null"
];

const corsOptions = {
  origin: function(origin, cb) { cb(null, true); },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Cookie"]
};

const sessionMiddleware = session({
  store: new RedisStore({ client: redis, prefix: "sess:" }),
  secret: process.env.SESSION_SECRET || "dev-secret-CHANGE-IN-PROD",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json());
app.use(sessionMiddleware);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Cookie,x-auth-token");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth",
  rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: "Too many auth attempts." } }),
  authRouter
);
app.use("/api/rooms", roomsRouter);

app.use("/api/admin", adminRouter);
app.use("/api/posts", postsRouter);

app.use(express.static(join(__dirname, "../public")));
app.get("*", (_, res) => res.sendFile(join(__dirname, "../public/index.html")));

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: true, credentials: true }, allowEIO3: true,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

io.engine.use(sessionMiddleware);
io.use(requireAuthSocket);
registerSocketHandlers(io);
app.set("io", io);

// Clear stale presence data on startup
async function clearStalePresence() {
  try {
    const keys = await redis.keys('room:*:members');
    if (keys.length) {
      await redis.del(...keys);
      console.log('Cleared stale presence for', keys.length, 'rooms');
    }
  } catch(e) { console.error('clearStalePresence:', e.message); }
}
clearStalePresence();

const PORT = parseInt(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  console.log(`✓ Ready → http://localhost:${PORT} [${process.env.NODE_ENV ?? "development"}]`);
});

process.on("unhandledRejection", err => console.error("UnhandledRejection:", err));

