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
    stockmarket: 'https://feeds.reuters.com/reuters/businessNews',
    technews: 'https://feeds.feedburner.com/TechCrunch',
    climate: 'https://www.theguardian.com/environment/climate-crisis/rss',
    summermovies: 'https://variety.com/feed/',
    romance: 'https://people.com/tag/celebrity-couples/feed/',
    relationships: 'https://people.com/tag/love/feed/',
    heartbroken: 'https://people.com/tag/breakups/feed/',
    space: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    tech: 'https://www.theverge.com/rss/index.xml',
    cooking: 'https://www.bonappetit.com/feed/rss',
    finance: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
    fitness: 'https://www.menshealth.com/rss/all.xml/',
    travel: 'https://www.lonelyplanet.com/news/feed',
    science: 'https://www.sciencedaily.com/rss/top/science.xml',
    movies: 'https://www.hollywoodreporter.com/feed/',
    music: 'https://pitchfork.com/rss/news/',
    history: 'https://www.smithsonianmag.com/rss/history-archaeology/',
    nature: 'https://feeds.nationalgeographic.com/ng/News/News_Main',
    psychology: 'https://rss.psychologytoday.com/rss/headlines',
    makefriends: 'https://people.com/tag/friendship/feed/',
  };
  const feed = feeds[req.params.roomId];
  if (!feed) return res.json([]);
  try {
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}&count=4`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await response.text();
    console.log('[news] response:', text.slice(0, 200));
    const d = JSON.parse(text);
    if (d.status !== 'ok') { console.log('[news] bad status:', d); return res.json([]); }
    const items = d.items.slice(0,3).map(i => ({ title: i.title, link: i.link }));
    res.json(items);
  } catch(e) { res.json([]); }
});

export default router;
