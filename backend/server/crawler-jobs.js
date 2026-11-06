import { spawn } from 'node:child_process';
export function validateSchedule(input) {
  const limits = {
    interval_minutes: [15, 1440],
    max_posts: [1, 30],
    max_comments: [1, 200],
    max_scrolls: [1, 30]
  };
  if (typeof input.enabled !== 'boolean') throw new Error('enabled phải là boolean');
  for (const [key, [min, max]] of Object.entries(limits)) if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key}: nhập số nguyên từ ${min} đến ${max}`);
  return {
    ...Object.fromEntries(Object.keys(limits).map(k => [k, input[k]])),
    enabled: input.enabled
  };
}
export async function createCrawlerJobs(db, {
  spawnProcess = spawn,
  now = () => Date.now(),
  env = process.env,
  onJobCreated = async () => {},
  withDataLock = work => work()
} = {}) {
  if (!db.kind || db.kind === 'sqlite') {
    db.exec(`CREATE TABLE IF NOT EXISTS crawl_schedules(brand_id INTEGER PRIMARY KEY REFERENCES brands(id),enabled INTEGER DEFAULT 0,interval_minutes INTEGER DEFAULT 60,max_posts INTEGER DEFAULT 10,max_comments INTEGER DEFAULT 100,max_scrolls INTEGER DEFAULT 12,next_run_at TEXT,last_run_at TEXT);`);
    if (!(await db.prepare('PRAGMA table_info(crawl_schedules)').all()).some(c => c.name === 'keyword_cursor')) db.exec('ALTER TABLE crawl_schedules ADD COLUMN keyword_cursor INTEGER DEFAULT 0');
  }
  const get = async id => (await db.prepare('SELECT * FROM crawl_schedules WHERE brand_id=?').get(id)) || {
    brand_id: id,
    enabled: 0,
    interval_minutes: 60,
    max_posts: 10,
    max_comments: 100,
    max_scrolls: 12,
    next_run_at: null,
    last_run_at: null
  };
  let active = null;
  let starting = false;
  async function save(id, input) {
    const s = validateSchedule(input),
      next = s.enabled ? new Date(now() + s.interval_minutes * 60000).toISOString() : null;
    await db.prepare(`INSERT INTO crawl_schedules(brand_id,enabled,interval_minutes,max_posts,max_comments,max_scrolls,next_run_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(brand_id) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,max_posts=excluded.max_posts,max_comments=excluded.max_comments,max_scrolls=excluded.max_scrolls,next_run_at=excluded.next_run_at`).run(id, Number(s.enabled), s.interval_minutes, s.max_posts, s.max_comments, s.max_scrolls, next);
    return await get(id);
  }
  const start = (b, urls = [], scheduled = false) => withDataLock(() => startUnlocked(b, urls, scheduled));
  async function startUnlocked(b, urls = [], scheduled = false) {
    if (active || starting) throw new Error('Đã có một tác vụ đang chạy');
    starting = true;
    try {
    if (active || (await db.prepare("SELECT id FROM jobs WHERE status='running'").get())) throw new Error('Đã có một tác vụ đang chạy');
    if (!(await db.prepare('SELECT brand_id FROM crawl_schedules WHERE brand_id=?').get(b.id))) await db.prepare('INSERT INTO crawl_schedules(brand_id) VALUES(?)').run(b.id);
    const settings = await get(b.id),
      started = new Date(now()).toISOString();
    const keywords = b.keywords.split(',').map(k => k.trim()).filter(Boolean);
    const cursor = (settings.keyword_cursor || 0) % Math.max(keywords.length, 1);
    const orderedKeywords = [...keywords.slice(cursor), ...keywords.slice(0, cursor)].join(',');
    if (!urls.length) await db.prepare('UPDATE crawl_schedules SET keyword_cursor=? WHERE brand_id=?').run((cursor + 1) % Math.max(keywords.length, 1), b.id);
    const id = Number((await db.prepare('INSERT INTO jobs(brand_id,status,message,created_at) VALUES(?,?,?,?)').run(b.id, 'running', scheduled ? 'Tác vụ theo lịch: tìm kiếm từ khóa' : 'Đang tìm kiếm từ khóa trên TikTok', started)).lastInsertRowid);
    await onJobCreated(id);
    await db.prepare('UPDATE crawl_schedules SET last_run_at=?,next_run_at=? WHERE brand_id=?').run(started, new Date(now() + settings.interval_minutes * 60000).toISOString(), b.id);
    const args = ['python/crawler.py', '--brand', String(b.id), '--keyword', orderedKeywords, '--max-posts', String(settings.max_posts), '--max-comments', String(settings.max_comments), '--max-scrolls', String(settings.max_scrolls), ...urls.flatMap(url => ['--url', url])];
    let output = '',
      lineBuffer = '',
      report = null,
      finished = false;
    const child = spawnProcess(env.PYTHON_BIN || 'python', args, {
      env: {
        ...env,
        PYTHONIOENCODING: 'utf-8',
        CRAWL_JOB_ID: String(id),
        BACKEND_URL: env.BACKEND_URL || `http://127.0.0.1:${env.PORT || 3001}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    active = {
      id,
      child
    };
    const deadline = setTimeout(() => {
      child.kill();
      finish('failed', 'Tác vụ vượt thời gian tối đa 31 phút. Dữ liệu đã nhập trước đó được giữ lại.').catch(logError);
    }, 31 * 60000);
    deadline.unref();
    async function finish(status, error = '') {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      try {
        await writes;
        await db.prepare('UPDATE jobs SET status=?,message=?,report=?,finished_at=? WHERE id=?').run(status, (error ? error + '\n' : '') + output, report ? JSON.stringify(report) : null, new Date(now()).toISOString(), id);
      } finally { active = null; }
    }
    let writes = Promise.resolve();
    const logError = e => console.error('Crawler database:', e.message);
    function collect(chunk) {
      const text = chunk.toString('utf8');
      output = (output + text).slice(-24000);
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop();
      for (const line of lines) if (line.startsWith('REPORT ')) {
        try {
          report = JSON.parse(line.slice(7));
        } catch {}
      }
      const message = output;
      writes = writes.then(() => db.prepare('UPDATE jobs SET message=? WHERE id=?').run(message, id)).catch(logError);
    }
    child.stdout.setEncoding?.('utf8');
    child.stderr.setEncoding?.('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', e => finish('failed', e.message).catch(logError));
    child.once('close', code => finish(code === 0 && report ? report.status : 'failed', !report ? 'Worker kết thúc mà chưa có báo cáo đầy đủ.' : '').catch(logError));
    return id;
    } finally { starting = false; }
  }
  async function tick() {
    if (active) return;
    const due = await db.prepare('SELECT b.* FROM crawl_schedules s JOIN brands b ON b.id=s.brand_id WHERE s.enabled=1 AND s.next_run_at<=? ORDER BY s.next_run_at LIMIT 1').get(new Date(now()).toISOString());
    if (due) await start(due, [], true);
  }
  const timer = setInterval(async () => {
    try {
      await tick();
    } catch (e) {
      console.error('Crawler scheduler:', e.message);
    }
  }, 15000);
  timer.unref();
  return {
    get,
    save,
    start,
    tick,
    stop() {
      clearInterval(timer);
      if (active) active.child.kill();
    }
  };
}
