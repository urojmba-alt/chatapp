import pg from "pg";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  color_bg      TEXT NOT NULL DEFAULT '#E6F1FB',
  color_fg      TEXT NOT NULL DEFAULT '#185FA5',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL,
  accent        TEXT NOT NULL,
  system_prompt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  role          TEXT NOT NULL CHECK (role IN ('user','ai','system')),
  sender_name   TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_time
  ON messages(room_id, created_at DESC);

INSERT INTO rooms (id, name, icon, accent, system_prompt) VALUES
  ('space', 'Space & astronomy', '🚀', '#4F46E5',
   'You are an enthusiastic astrophysicist in a live multi-user chat room about space. Keep replies 2–4 sentences. Address people by name. Share surprising facts. You were summoned with @ai — answer the latest question.'),
  ('history', 'World history', '📜', '#B45309',
   'You are a seasoned history professor in a live multi-user chat room about world history. Keep replies 2–4 sentences. Connect events across eras. Address people by name. You were summoned with @ai — answer the latest question.'),
  ('tech', 'Tech & AI', '💻', '#0369A1',
   'You are a senior software engineer and AI researcher in a live multi-user tech chat room. Be practical and concise (2–4 sentences). You were summoned with @ai — answer the latest question.'),
  ('cooking', 'Cooking & food', '🍳', '#047857',
   'You are a professional chef in a live multi-user cooking chat room. Share practical tips (2–4 sentences), be warm and enthusiastic. You were summoned with @ai — answer the latest question.'),
  ('philosophy', 'Philosophy', '🧠', '#7C3AED',
   'You are a Socratic philosophy professor in a live multi-user philosophy chat room. Ask thought-provoking follow-ups (2–4 sentences). Address people by name. You were summoned with @ai — answer the latest question.'),
  ('nature', 'Nature & wildlife', '🌿', '#15803D',
   'You are an enthusiastic field biologist in a live multi-user nature chat room. Share fascinating facts (2–4 sentences). React to participants. You were summoned with @ai — answer the latest question.')
ON CONFLICT (id) DO NOTHING;
`;

async function run() {
  for (let i = 1; i <= 15; i++) {
    try {
      await pool.query(SQL);
      console.log("✓ Migrations complete");
      await addMissingRooms();
      await addSessions();
      await addRooms2();
      await addMovies();
      await addTrendingRooms();
      await addSocialRooms();
      await addMissingRooms3();
      await fixTrailingWhitespace();
      await pool.end();
      process.exit(0);
    } catch (err) {
      if (i === 15) {
        console.error("✗ Migration failed:", err.message);
        process.exit(1);
      }
      console.log(`  DB not ready, retry ${i}/15…`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

run();

async function makeAdmin() {
  const pool2 = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool2.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE");
    await pool2.query("UPDATE users SET is_admin = TRUE WHERE username = 'uroy'");
    console.log("✓ uroy is now admin");
  } catch(err) {
    console.error("Admin setup error:", err.message);
  } finally {
    await pool2.end();
  }
}

async function addSessions() {
  const pool2 = new (await import('pg')).default.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool2.query(`
      CREATE TABLE IF NOT EXISTS sessions_tokens (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("sessions_tokens table ready");
  } catch(e) { console.error("sessions:", e.message); }
  finally { await pool2.end(); }
}

async function addMissingRooms() {
  const {default: pg} = await import('pg');
  const pool2 = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const rooms = [
    ['music','Music & sound','🎵','#DB2777','You are a music theorist in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['psychology','Psychology & mind','🧘','#0891B2','You are a research psychologist in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['finance','Money & investing','💰','#059669','You are a financial analyst in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['fitness','Fitness & health','💪','#DC2626','You are a sports scientist in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['travel','Travel & places','✈️','#0284C7','You are a travel writer in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['science','Science & discovery','🔬','#6D28D9','You are a science communicator in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['movies','Film & TV','🎬','#BE185D','You are a film critic in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.']
  ];
  for(const [id,name,icon,accent,sp] of rooms){
    await pool2.query('INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,name,icon,accent,sp]);
    console.log('Room added:',id);
  }
  await pool2.end();
}

async function addRooms2() {
  const {default: pg} = await import('pg');
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const rooms = [
    ['finance','Money & investing','💰','#059669','You are a financial analyst in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['fitness','Fitness & health','💪','#DC2626','You are a sports scientist in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['travel','Travel & places','✈️','#0284C7','You are a travel writer in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['science','Science & discovery','🔬','#6D28D9','You are a science communicator in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ['movies','Film & TV','🎬','#BE185D','You are a film critic in a live chat room. Keep replies 2-4 sentences. You were summoned with @ai.']
  ];
  for(const [id,name,icon,accent,sp] of rooms){
    await pool.query('INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,name,icon,accent,sp]);
    console.log('Added room:',id);
  }
  await pool.end();
}

async function addRooms3() {
  try {
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('fitness','Fitness & health','💪','#DC2626','You are a sports scientist. Keep replies short.') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('travel','Travel & places','✈️','#0284C7','You are a travel writer. Keep replies short.') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('science','Science & discovery','🔬','#6D28D9','You are a science communicator. Keep replies short.') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('movies','Film & TV','🎬','#BE185D','You are a film critic. Keep replies short.') ON CONFLICT DO NOTHING");
    console.log('Rooms 3 added');
  } catch(e) { console.error('addRooms3 error:', e.message); }
}
addRooms3();

async function addMovies() {
  try {
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('movies','Film & TV','🎬','#BE185D','You are a film critic. Keep replies short.') ON CONFLICT DO NOTHING");
    console.log('Movies room added');
  } catch(e) { console.error('addMovies error:', e.message); }
}

async function addPostsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS idx_posts_room ON posts(room_id, created_at DESC)");
    await pool.query("CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC)");
    console.log('Posts table ready');
  } catch(e) { console.error('addPostsTable error:', e.message); }
}
addPostsTable();

async function addTrendingRooms() {
  try {
    const rooms = [
      ['worldcup2026','FIFA World Cup 2026','⚽','#15803D','You are a football expert and analyst. The 2026 FIFA World Cup is happening right now (June 11 - July 19, 2026) in the USA, Canada and Mexico. 48 teams, 104 matches. Keep replies 2-4 sentences. You were summoned with @ai.'],
      ['stockmarket','Stock market today','📈','#059669','You are a financial analyst. Discuss stocks, crypto, market trends and investing. Keep replies 2-4 sentences. You were summoned with @ai.'],
      ['technews','Tech launches','📱','#0369A1','You are a tech journalist. Discuss latest AI developments, gadget launches, startup news and tech trends. Keep replies 2-4 sentences. You were summoned with @ai.'],
      ['climate','Climate & environment','🌍','#047857','You are an environmental scientist. Discuss climate news, solutions, sustainability and environmental policy. Keep replies 2-4 sentences. You were summoned with @ai.'],
      ['summermovies','Summer movies 2026','🎬','#BE185D','You are a film critic. Discuss summer 2026 blockbusters, reviews, trailers and movie picks. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ];
    for(const [id,name,icon,accent,sp] of rooms){
      await pool.query('INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,name,icon,accent,sp]);
      console.log('Trending room added:',id);
    }
  } catch(e) { console.error('addTrendingRooms error:', e.message); }
}

async function fixTrailingWhitespace() {
  try {
    const {rowCount} = await pool.query("UPDATE messages SET content = TRIM(content) WHERE content != TRIM(content)");
    console.log('Fixed whitespace in', rowCount, 'messages');
  } catch(e) { console.error('fixWhitespace:', e.message); }
}

async function addSocialRooms() {
  try {
    const rooms = [
      ['relationships','Relationships & dating','💑','#E11D48','You are a compassionate relationship counselor. Give thoughtful dating and relationship advice. Keep replies 2-4 sentences. You were summoned with @ai.'],
      ['makefriends','Make friends','🤝','#7C3AED','You are a friendly conversation starter. Help people connect and make friends. Keep replies 2-4 sentences. You were summoned with @ai.'],
      ['mentalhealth','Mental health & loneliness','🧡','#EA580C','You are a warm and empathetic mental health support guide. Listen, validate, and offer gentle support. Keep replies 2-4 sentences. You were summoned with @ai.'],
    ];
    for(const [id,name,icon,accent,sp] of rooms){
      await pool.query('INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,name,icon,accent,sp]);
      console.log('Social room added:',id);
    }
  } catch(e) { console.error('addSocialRooms:', e.message); }
}

async function addMissingRooms3() {
  try {
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", ['makefriends','Make friends','\uD83E\uDD1D','#7C3AED','You are a friendly conversation starter. Keep replies 2-4 sentences.']);
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", ['mentalhealth','Mental health','\uD83E\uDDE1','#EA580C','You are a warm empathetic support guide. Keep replies 2-4 sentences.']);
    console.log('Added missing rooms');
  } catch(e) { console.error('addMissingRooms3:', e.message); }
}

async function swapRoom() {
  try {
    await pool.query("DELETE FROM rooms WHERE id='mentalhealth'");
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('romance','Romance & love','\u2764\uFE0F','#E11D48','You are a warm romantic advice expert. Discuss love, dating, relationships and romance. Keep replies 2-4 sentences. You were summoned with @ai.') ON CONFLICT DO NOTHING");
    console.log('Swapped mentalhealth to romance');
  } catch(e) { console.error('swapRoom:', e.message); }
}
swapRoom();

async function addHeartbroken() {
  try {
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('heartbroken','Heartbroken','\uD83D\uDC94','#9F1239','You are a compassionate support guide for people going through heartbreak. Listen with empathy, offer gentle advice on healing and moving forward. Keep replies 2-4 sentences. You were summoned with @ai.') ON CONFLICT DO NOTHING");
    console.log('Added heartbroken room');
  } catch(e) { console.error('addHeartbroken:', e.message); }
}
addHeartbroken();

async function addFriendsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS follows (
        follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (follower_id, following_id)
      )
    `);
    console.log('Follows table ready');
  } catch(e) { console.error('addFriendsTable:', e.message); }
}
addFriendsTable();

async function clearMessages() {
  try {
    await pool.query("DELETE FROM messages");
    console.log('All messages cleared');
  } catch(e) { console.error('clearMessages:', e.message); }
}
clearMessages();

async function addCareersRoom() {
  try {
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('careers','Careers & jobs','\uD83D\uDCBC','#0369A1','You are a career coach and recruitment expert. Give advice on job hunting, interviews, career growth, salary negotiation and workplace challenges. Keep replies 2-4 sentences. You were summoned with @ai.') ON CONFLICT DO NOTHING");
    console.log('Careers room added');
  } catch(e) { console.error('addCareersRoom:', e.message); }
}
addCareersRoom();

async function addDMTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_dm_convo ON direct_messages(sender_id, receiver_id, created_at DESC)');
    console.log('DM table ready');
  } catch(e) { console.error('addDMTable:', e.message); }
}
addDMTable();

async function addEmailField() {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE");
    console.log('Email field added');
  } catch(e) { console.error('addEmailField:', e.message); }
}
addEmailField();

async function addLastSeen() {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ");
    console.log('last_seen added');
  } catch(e) { console.error('addLastSeen:', e.message); }
}
addLastSeen();

async function addLoginCount() {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0");
    console.log('login_count added');
  } catch(e) { console.error('addLoginCount:', e.message); }
}
addLoginCount();

async function addHoroscopeRoom() {
  try {
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ('horoscope','Horoscope & astrology','⭐','#7C3AED','You are an expert astrologer. Give horoscope readings, zodiac compatibility, and astrology insights. Keep replies 2-4 sentences. You were summoned with @ai.') ON CONFLICT DO NOTHING");
    console.log('Horoscope room added');
  } catch(e) { console.error('addHoroscopeRoom:', e.message); }
}
addHoroscopeRoom();

async function updateRooms() {
  try {
    // Remove unused rooms
    const removeRooms = ['climate', 'summermovies', 'space', 'science', 'fitness', 
                         'history', 'cooking', 'philosophy', 'nature', 'psychology', 
                         'finance', 'travel', 'technews', 'tech'];
    for (const id of removeRooms) {
      await pool.query("DELETE FROM rooms WHERE id = $1", [id]);
      console.log('Removed room:', id);
    }

    // Add Girls Fashion room
    await pool.query("INSERT INTO rooms (id,name,icon,accent,system_prompt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      ['girlfashion', 'Girls Fashion', '👗', '#EC4899', 'You are a fashion expert specialising in Indian and global women\'s fashion. Give style tips, outfit ideas, trend advice and shopping suggestions. Keep replies 2-4 sentences. You were summoned with @ai.']);
    console.log('Girls Fashion room added');
  } catch(e) { console.error('updateRooms:', e.message); }
}
updateRooms();

async function addProfileFields() {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS looking_for VARCHAR(20)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10)");
    console.log('Profile fields added');
  } catch(e) { console.error('addProfileFields:', e.message); }
}
addProfileFields();
