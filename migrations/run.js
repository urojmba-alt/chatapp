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
makeAdmin();

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
addSessions();

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
addMissingRooms();
