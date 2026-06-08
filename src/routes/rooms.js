import { Router } from "express";
import db from "../lib/db.js";
import { getMemberCount } from "../lib/redis.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* GET /api/rooms */
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT id, name, icon, accent FROM rooms ORDER BY id");
    const online = await Promise.all(rows.map(r => getMemberCount(r.id)));
    res.json(rows.map((r, i) => ({ ...r, online: online[i] })));
  } catch (err) {
    console.error("rooms list:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* GET /api/rooms/:id/messages?before=<uuid>&limit=50 */
router.get("/:id/messages", requireAuth, async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before;

  try {
    let rows;
    if (before) {
      ({ rows } = await db.query(
        `SELECT id, role, sender_name, content, created_at FROM messages
         WHERE room_id=$1
           AND created_at < (SELECT created_at FROM messages WHERE id=$2 LIMIT 1)
         ORDER BY created_at DESC LIMIT $3`,
        [id, before, limit]
      ));
    } else {
      ({ rows } = await db.query(
        `SELECT id, role, sender_name, content, created_at FROM messages
         WHERE room_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [id, limit]
      ));
    }
    res.json(rows.reverse());
  } catch (err) {
    console.error("messages:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


// News proxy endpoint
router.get('/news/:roomId', async (req, res) => {
  const feeds = {
    romance: 'https://www.theguardian.com/lifeandstyle/relationships/rss',
    relationships: 'https://www.theguardian.com/lifeandstyle/relationships/rss',
    heartbroken: 'https://www.theguardian.com/lifeandstyle/relationships/rss',
    makefriends: 'https://www.theguardian.com/world/india/rss',
    girlfashion: 'https://www.theguardian.com/fashion/rss',
    worldcup2026: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    stockmarket: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    tech: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    movies: 'https://www.theguardian.com/film/rss',
    music: 'https://www.theguardian.com/music/rss',
    horoscope: 'https://www.theguardian.com/lifeandstyle/rss',
    careers: 'https://www.theguardian.com/careers/rss',
  };
  const feed = feeds[req.params.roomId];
  if (!feed) return res.json([]);
  try {
    const r = await fetch(feed, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml,text/xml' }, signal: AbortSignal.timeout(5000) });
    const xml = await r.text();
    console.log('[news] roomId:', req.params.roomId, 'status:', r.status, 'length:', xml.length, 'preview:', xml.slice(0,100));
    // Simple XML parser for RSS items
    const items = [];
    const tagName = xml.includes('<entry') ? 'entry' : 'item';
    const itemMatches = xml.matchAll(new RegExp(`<${tagName}[^>]*>([\s\S]*?)<\/${tagName}>`, 'g'));
    for (const m of itemMatches) {
      const item = m[1];
      const title = item.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1]?.trim();
      const link = item.match(/<link[^>]*>(.*?)<\/link>/)?.[1]?.trim() || item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim();
      if (title && link && link.startsWith('http')) items.push({ title, link });
      if (items.length >= 3) break;
    }
    res.json(items);
  } catch(e) { console.log('[news error]', e.message); res.json([]); }
});

export default router;
