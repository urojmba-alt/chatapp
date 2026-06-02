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

    socket.on("room:join", async (roomId) => {
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
      const { rows:[saved] } = await db.query("INSERT INTO messages (room_id,user_id,role,sender_name,content) VALUES ($1,$2,'user',$3,$4) RETURNING id,created_at",[roomId,user.id,user.name,content]);
      io.to(roomId).emit("message:new",{id:saved.id,role:"user",sender_name:user.name,color:user.color,content,created_at:saved.created_at});
      if(/@ai\b/i.test(content)){triggerAI(io,socket,roomId,user);}else{getMemberCount(roomId).then(c=>{if(c<=1&&Math.random()<0.6)setTimeout(()=>triggerAI(io,socket,roomId,user),1500);});}
    });

    socket.on("typing:start",()=>{ if(socket.currentRoom) socket.to(socket.currentRoom).emit("user:typing",{name:user.name}); });
    socket.on("typing:stop",()=>{ if(socket.currentRoom) socket.to(socket.currentRoom).emit("user:stopped",{name:user.name}); });
    socket.on("ping",()=>{ socket.emit("pong"); });
    socket.on("disconnect", async()=>{ await leave(socket,io,user); console.log(`[-] ${user.name}`); });
  });
}
