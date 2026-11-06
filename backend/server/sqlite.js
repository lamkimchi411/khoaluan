import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
export function createSqliteDatabase() {
mkdirSync("data", { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || "data/brandpulse.db");
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS brands(id INTEGER PRIMARY KEY,name TEXT NOT NULL,keywords TEXT NOT NULL,threshold REAL DEFAULT 40);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,video_id TEXT NOT NULL,brand_id INTEGER REFERENCES brands(id),caption TEXT,author TEXT,views INTEGER,likes INTEGER,comment_count INTEGER,video_url TEXT,sentiment TEXT,score REAL,created_at TEXT,source TEXT,UNIQUE(video_id,brand_id));
CREATE TABLE IF NOT EXISTS comments(id TEXT,post_id INTEGER REFERENCES posts(id),text TEXT,author TEXT,sentiment TEXT,score REAL,created_at TEXT,PRIMARY KEY(id,post_id));
CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,brand_id INTEGER REFERENCES brands(id),reason TEXT,level TEXT,status TEXT DEFAULT 'open',created_at TEXT);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,brand_id INTEGER,status TEXT,message TEXT,created_at TEXT);`);
if (!db.prepare("SELECT id FROM brands LIMIT 1").get()) {
  const ins = db.prepare("INSERT INTO brands(name,keywords) VALUES(?,?)");
  ins.run("VinFast", "VinFast, VF 3, VF 8");
  ins.run("Shopee", "Shopee, ShopeeFood");
  ins.run("Fahasa", "Fahasa, Nhà sách Fahasa");
}
for (const [table, column, definition] of [
  ["posts", "observed_at", "TEXT DEFAULT ''"],
  ["posts", "published_at", "TEXT"],
  ["posts", "collection_method", "TEXT"],
  ["posts", "evidence_sha256", "TEXT"],
  ["posts", "author_nickname", "TEXT"],
  ["posts", "hashtags", "TEXT"],
  ["posts", "shares", "INTEGER"],
  ["posts", "saves", "INTEGER"],
  ["posts", "comment_status", "TEXT"],
  ["posts", "discovery_keyword", "TEXT"],
  ["comments", "author_nickname", "TEXT"],
  ["comments", "parent_id", "TEXT"],
  ["comments", "like_count", "INTEGER"],
  ["comments", "published_at", "TEXT"],
  ["jobs", "report", "TEXT"],
  ["jobs", "finished_at", "TEXT"],
  ["brands", "email", "TEXT DEFAULT ''"],
  ["brands", "telegram", "TEXT DEFAULT ''"],
  ["alerts", "delivery", "TEXT DEFAULT 'Chỉ thông báo trong ứng dụng'"],
]) {
  if (
    !db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === column)
  )
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

db.exec(`CREATE TABLE IF NOT EXISTS staff(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id), post_id INTEGER REFERENCES posts(id), comment_id TEXT,
  risk_score REAL NOT NULL, severity TEXT NOT NULL, queue TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  assignee_id INTEGER REFERENCES staff(id), created_at TEXT NOT NULL, accepted_at TEXT, resolved_at TEXT,
  due_at TEXT NOT NULL, escalated_at TEXT, resolution_note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ticket_actions(
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_responses(
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved', approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
  published_at TEXT, publish_mode TEXT, published_url TEXT
);
CREATE INDEX IF NOT EXISTS tickets_brand_status_idx ON tickets(brand_id,status,created_at DESC);`);
if (!db.prepare('SELECT id FROM staff LIMIT 1').get()) {
  for (const [name, role] of [['Linh CSKH','cskh'],['Minh CSKH','cskh'],['An PR Manager','pr'],['Quản trị viên','admin']])
    db.prepare('INSERT INTO staff(name,role) VALUES(?,?)').run(name,role);
}

 db.kind='sqlite';
 db.transaction=async work=>{db.exec('BEGIN');try{const result=await work();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
return db;
}
