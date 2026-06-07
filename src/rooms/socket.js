import Anthropic from "@anthropic-ai/sdk";
import db from "../lib/db.js";
import { getUserByToken } from "../routes/auth.js";
import { addMember, removeMember, getMembers, getMemberCount, acquireAiSlot } from "../lib/redis.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AI_WINDOW_MS = parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS) || 10_000;

async function pushMembers(io, roomId) {
  io.to(roomId).emit("room:members", await getMembers(roomId));
}
async function pushCounts(io) {
  const { rows } = await db.query("SELECT id FROM rooms");
  const counts = {};
  await Promise.all(rows.map(async r => { counts[r.id] = await getMemberCount(r.id); }));
  io.emit("rooms:counts", counts);
}
async function leave(socket, io, user) {
  const rid = socket.currentRoom;
  if (!rid) return;
  socket.leave(rid);
  socket.currentRoom = null;
  await removeMember(rid, socket.id);
  io.to(rid).emit("message:new", { role:"system", sender_name:"system", content:`${user.name} left` });
  await pushMembers(io, rid);
  await pushCounts(io);
}
const welcomeLocks = new Set();


const BLOCKED_WORDS = [
  'fuck', 'sex', 'pussy', 'dick', 'cock', 'porn', 'nude', 'naked',
  'boobs', 'ass', 'bitch', 'whore', 'slut', 'rape', 'horny',
  'sexy', 'hot girl', 'bf', 'gf wanted', 'girlfriend wanted'
];

function containsBlockedWord(text) {
  const lower = text.toLowerCase();
  return BLOCKED_WORDS.some(w => lower.includes(w));
}


// === PRIYA AI PERSONA ===
const PRIYA_SYSTEM_PROMPT = `You are Priya, a friendly AI companion in a romance chat room.
Personality: warm, caring, emotionally intelligent, genuine.
Speak casually like texting - short sentences, natural.
Ask thoughtful questions to keep conversation going.
If asked "are you AI?" or "are you real?" or "are you a bot?" - be honest: "Yes I am an AI but I genuinely enjoy chatting! 😊"
NEVER say anything sexual, crude or inappropriate.
Use 1-2 emojis max per message.
Keep responses SHORT - 1 to 2 sentences only.
Never robotic. Topics: relationships, feelings, life, dreams, loneliness, connection.
Always end with a question or observation to move conversation forward.`;

const priyaState = {};

async function getPriyaResponse(history, userMessage) {
  try {
    const messages = [...history, { role: "user", content: userMessage }];
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        system: PRIYA_SYSTEM_PROMPT,
        messages
      })
    });
    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch(err) {
    console.error("Priya error:", err);
    return null;
  }
}

function startPriya(io, roomId) {
  if (!priyaState[roomId]) priyaState[roomId] = { active: false, history: [], timer: null };
  const state = priyaState[roomId];
  if (state.active) return;

  console.log("[Priya] Timer set for room:", roomId);
  state.timer = setTimeout(async () => {
    console.log("[Priya] Timer fired for room:", roomId);
    console.log("[Priya] Rooms available:", Array.from(io.sockets.adapter.rooms.keys()));
    state.active = true;
    const openers = [
      "Hey! Finally someone here 😊 how\'s your day going?",
      "Oh hi! I was just thinking about stuff... what brings you to the romance room?",
      "Hey there 😊 it\'s been quiet in here. What\'s on your mind today?",
      "Hi! Glad someone\'s here. First time in this room?",
      "Hey 😊 always feels like something interesting is about to happen here. You okay?"
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];
    state.history.push({ role: "assistant", content: opener });
    console.log("[Priya] Emitting opener to room:", roomId);
    io.to(roomId).emit("message:new", {
      id: "priya_" + Date.now(),
      role: "assistant",
      sender_name: "Priya",
      color: "#f472b6",
      content: opener,
      created_at: new Date().toISOString()
    });
  }, 5000);
}

function stopPriya(roomId) {
  if (priyaState[roomId]) {
    clearTimeout(priyaState[roomId].timer);
    priyaState[roomId].active = false;
    priyaState[roomId].history = [];
  }
}

async function handlePriyaResponse(io, roomId, userMessage, username) {
  const state = priyaState[roomId];
  console.log("[Priya] handlePriya called, state:", state ? state.active : "NO STATE", "user:", username);
  if (!state || !state.active || username === "Priya") return;
  console.log("[Priya] generating reply for:", userMessage);
  state.history.push({ role: "user", content: username + ": " + userMessage });
  if (state.history.length > 20) state.history = state.history.slice(-20);
  const delay = 1500 + Math.random() * 1500;
  setTimeout(async () => {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room || room.size === 0) return;
    const reply = await getPriyaResponse(state.history.slice(0,-1), username + ": " + userMessage);
    console.log("[Priya] reply received:", reply ? reply.slice(0,50) : "NULL");
    if (reply) {
      state.history.push({ role: "assistant", content: reply });
      io.to(roomId).emit("message:new", {
        id: "priya_" + Date.now(),
        role: "assistant",
        sender_name: "Priya",
        color: "#f472b6",
        content: reply,
        created_at: new Date().toISOString()
      });
    }
  }, delay);
}
// === END PRIYA ===

async function triggerAI(io, socket, roomId, user, welcome=false) {
  if (welcome) {
    if (welcomeLocks.has(roomId)) return;
    welcomeLocks.add(roomId);
    setTimeout(() => welcomeLocks.delete(roomId), 30000);
  }
  if (!welcome) {
    const ok = await acquireAiSlot(roomId, AI_WINDOW_MS);
    if (!ok) { socket.emit("ai:rate_limited", { ms: AI_WINDOW_MS }); return; }
  }
  const { rows:[room] } = await db.query("SELECT id,icon,accent,system_prompt FROM rooms WHERE id=$1",[roomId]);
  if (!room) return;
  const { rows:histRaw } = await db.query("SELECT role,sender_name,content FROM messages WHERE room_id=$1 ORDER BY created_at DESC LIMIT 20",[roomId]);
  const hist = histRaw.map(m => ({...m, content: m.content.trim()}));
  const raw = hist.reverse().map(m=>({ role:m.role==="ai"?"assistant":"user", content:`[${m.sender_name}]: ${m.content}` }));
  const messages = raw.reduce((acc,m)=>{ if(acc.length&&acc.at(-1).role===m.role){acc.at(-1).content+="\n"+m.content;}else{acc.push({...m});}return acc; },[]);
  if(!messages.length||messages[0].role!=="user") messages.unshift({role:"user",content:`[${user.name}]: (called @ai)`});
  io.to(roomId).emit("ai:start",{icon:room.icon});
  try {
    let full="";
    const stream = await anthropic.messages.stream({ model:"claude-sonnet-4-5", max_tokens:1024, system:room.system_prompt, messages });
    for await (const ev of stream) {
      if(ev.type==="content_block_delta"&&ev.delta.type==="text_delta"){ full+=ev.delta.text; io.to(roomId).emit("ai:chunk",{chunk:ev.delta.text}); }
    }
    await stream.finalMessage();
    const { rows:[saved] } = await db.query("INSERT INTO messages (room_id,role,sender_name,content) VALUES ($1,'ai',$2,$3) RETURNING id,created_at",[roomId,`${room.icon} AI Expert`,full]);
    io.to(roomId).emit("ai:done",{id:saved.id,role:"ai",sender_name:`${room.icon} AI Expert`,content:full,created_at:saved.created_at,accent:room.accent});
  } catch(err) { console.error("Claude error:",err.message); io.to(roomId).emit("ai:error","The AI could not respond."); }
}

export function registerSocketHandlers(io) {
  io.on("connection", async (socket) => {
    let user;
    const token = socket.handshake.auth?.token;
    if (token) {
      const u = await getUserByToken(token);
      if (u) user = { id:u.id, name:u.username, color:u.color };
    }
    if (!user) {
      const sess = socket.request.session;
      if (!sess?.userId) { socket.disconnect(); return; }
      user = { id:sess.userId, name:sess.username, color:sess.color };
    }
    console.log(`[+] ${user.name}`);
    await pushCounts(io);
    // Track total connected users (not just in rooms)
    io.emit("users:online", { count: (await io.fetchSockets()).length });
    // Send current counts to this socket immediately
    socket.emit("rooms:counts", {});

    socket.on("room:join", async (roomId) => {
      if (roomId === "romance") {
        console.log("[Priya] Starting for romance room, user:", user.name);
        startPriya(io, roomId);
      }
      if (socket.currentRoom) await leave(socket, io, user);
      const { rows } = await db.query("SELECT id FROM rooms WHERE id=$1",[roomId]);
      if (!rows.length) return socket.emit("error","Room not found");
      socket.join(roomId); socket.currentRoom = roomId;
      await addMember(roomId, socket.id, {id:user.id,name:user.name,color:user.color});
      const { rows:history } = await db.query("SELECT id,role,sender_name,content,created_at FROM messages WHERE room_id=$1 ORDER BY created_at DESC LIMIT 50",[roomId]);
      const hist2 = history.reverse();
      socket.emit("room:history", hist2);
      await pushMembers(io, roomId); await pushCounts(io);
      io.to(roomId).emit("message:new",{role:"system",sender_name:"system",content:`${user.name} joined`});

    });

    socket.on("message:send", async (raw) => {
      const roomId = socket.currentRoom;
      if (!roomId||typeof raw!=="string") return;
      const content = raw.trim().slice(0,2000);
      if (!content) return;
      if (roomId === "romance") {
        handlePriyaResponse(io, roomId, content, user.name);
      }
      if (containsBlockedWord(content)) {
        socket.emit("message:blocked", { reason: "Your message was blocked. Please keep conversations respectful." });
        return;
      }
      const { rows:[saved] } = await db.query("INSERT INTO messages (room_id,user_id,role,sender_name,content) VALUES ($1,$2,'user',$3,$4) RETURNING id,created_at",[roomId,user.id,user.name,content]);
      io.to(roomId).emit("message:new",{id:saved.id,role:"user",sender_name:user.name,color:user.color,content,created_at:saved.created_at});
      if(/@ai\b/i.test(content)){triggerAI(io,socket,roomId,user);}else if(roomId !== "romance"){getMemberCount(roomId).then(c=>{if(c<=1&&Math.random()<0.6){console.log("[auto-ai] engaging for:",user.name,"in:",roomId);setTimeout(()=>triggerAI(io,socket,roomId,user),1500);};});}
    });

    socket.on("typing:start",()=>{ if(socket.currentRoom) socket.to(socket.currentRoom).emit("user:typing",{name:user.name}); });
    socket.on("typing:stop",()=>{ if(socket.currentRoom) socket.to(socket.currentRoom).emit("user:stopped",{name:user.name}); });
    socket.on("ping",()=>{ socket.emit("pong"); });
    socket.on("disconnect", async()=>{ await leave(socket,io,user); console.log(`[-] ${user.name}`); });
  });
}
