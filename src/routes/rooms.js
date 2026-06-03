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
    worldcup2026: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    space: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    technews: 'https://techcrunch.com/feed/',
    stockmarket: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
    climate: 'https://www.theguardian.com/environment/climate-crisis/rss',
    summermovies: 'https://variety.com/feed/',
    romance: 'https://people.com/tag/celebrity-couples/feed/',
    tech: 'https://www.theverge.com/rss/index.xml',
    science: 'https://www.sciencedaily.com/rss/top/science.xml',
    music: 'https://pitchfork.com/rss/news/',
    movies: 'https://www.hollywoodreporter.com/feed/',
    fitness: 'https://www.runnersworld.com/feed/all/',
  };
  const feed = feeds[req.params.roomId];
  if (!feed) return res.json([]);
  try {
    const r = await fetch(feed, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml,text/xml' }, signal: AbortSignal.timeout(5000) });
    const xml = await r.text();
    // Simple XML parser for RSS items
    const items = [];
    const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g);
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
