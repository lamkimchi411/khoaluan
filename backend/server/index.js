import express from 'express';
import { spawn } from 'node:child_process';
import { crisis, validatePost, viralSpike, riskScore, severityForRisk } from './logic.js';
import { createCrawlerJobs } from './crawler-jobs.js';
import { createMysqlDatabase } from './mysql.js';
import { createSqliteDatabase } from './sqlite.js';
import { createPostgresDatabase } from './postgres.js';
import { createCrawlData } from './crawl-data.js';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
// Explicit process settings (test, Docker, deployment) must take precedence
// over local backend/.env values.
const explicitEnvironment = { ...process.env };
try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
Object.assign(process.env, explicitEnvironment);
const driver = process.env.DB_DRIVER || 'mysql';
if (!['mysql', 'sqlite', 'postgres'].includes(driver)) throw Error('DB_DRIVER phải là mysql, postgres hoặc sqlite');
const db = driver === 'postgres' ? await createPostgresDatabase({ schema: process.env.PG_SCHEMA || 'public' }) : driver === 'mysql' ? await createMysqlDatabase() : createSqliteDatabase();
if (!(await db.prepare('SELECT id FROM brands LIMIT 1').get())) {
  for (const [name, keywords] of [['VinFast', 'VinFast, VF 3, VF 8'], ['Shopee', 'Shopee, ShopeeFood'], ['Fahasa', 'Fahasa, Nhà sách Fahasa']]) await db.prepare('INSERT INTO brands(name,keywords) VALUES(?,?)').run(name, keywords);
}
if (!(await db.prepare('SELECT id FROM staff LIMIT 1').get())) {
  for (const [name, role] of [['Linh CSKH','cskh'],['Minh CSKH','cskh'],['An PR Manager','pr'],['Quản trị viên','admin']])
    await db.prepare('INSERT INTO staff(name,role) VALUES(?,?)').run(name, role);
}
const app = express();
app.use(express.json({
  limit: '2mb'
}));
const all = async (sql, ...args) => await db.prepare(sql).all(...args);
const brand = async id => await db.prepare("SELECT * FROM brands WHERE id=?").get(Number(id));
const crawlData = await createCrawlData(db);
const crawlerJobs = await createCrawlerJobs(db, { onJobCreated: crawlData.register, withDataLock: crawlData.exclusive });
app.get('/api/brands/:id/jobs', async (req,res) => {
  const brandId = Number(req.params.id), before = Number(req.query.before || Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(brandId) || !Number.isSafeInteger(before)) return res.status(400).json({error:'ID không hợp lệ'});
  const rows = await all('SELECT j.*,r.job_id AS tracked_job_id,r.deleted_at FROM jobs j LEFT JOIN crawl_data_runs r ON r.job_id=j.id WHERE j.brand_id=? AND j.id<? ORDER BY j.id DESC LIMIT 21',brandId,before);
  res.json({ jobs:rows.slice(0,20), has_more: rows.length>20 });
});
app.get('/api/jobs/:id/data', async (req,res) => {
  const id=Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<=0) return res.status(400).json({error:'ID không hợp lệ'});
  try { res.json(await crawlData.preview(id)); } catch(e) { res.status(e.status||500).json({error:e.message}); }
});
app.delete('/api/jobs/:id/data', async (req,res) => {
  const id=Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<=0 || req.body?.confirm_job_id!==id) return res.status(400).json({error:'Vui lòng xác nhận đúng lượt quét cần xoá'});
  try { res.json(await crawlData.remove(id)); } catch(e) { res.status(e.status||500).json({error:e.message}); }
});
app.get('/api/brands/:id/schedule', async (req, res) => {
  const b = await brand(req.params.id);
  if (!b) return res.sendStatus(404);
  res.json(await crawlerJobs.get(b.id));
});
app.put('/api/brands/:id/schedule', async (req, res) => {
  const b = await brand(req.params.id);
  if (!b) return res.sendStatus(404);
  try {
    res.json(await crawlerJobs.save(b.id, req.body));
  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});
async function analyze(texts) {
  const r = await fetch(`${process.env.NLP_URL || "http://127.0.0.1:8001"}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      texts
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error("Dịch vụ NLP không sẵn sàng");
  return (await r.json()).results;
}
async function raiseAlert(id, reason, { force = false } = {}) {
  const since = new Date(Date.now() - 3600000).toISOString();
  if (!force && await db.prepare("SELECT id FROM alerts WHERE brand_id=? AND created_at>=?").get(id, since)) return;
  const result = await db.prepare("INSERT INTO alerts(brand_id,reason,level,created_at) VALUES(?,?,?,?)").run(id, reason, "high", new Date().toISOString());
  const b = await brand(id);
  if (!b.email && !b.telegram) return;
  const child = spawn(process.env.PYTHON_BIN || "python", ["python/notify.py"], {
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8"
    },
    stdio: ["pipe", "pipe", "ignore"]
  });
  let output = "";
  child.stdout.on("data", x => output = (output + x).slice(-1000));
  child.stdin.on("error", () => {});
  child.on("error", async () => await db.prepare("UPDATE alerts SET delivery=? WHERE id=?").run("Không khởi động được dịch vụ thông báo", result.lastInsertRowid));
  child.on("close", async () => await db.prepare("UPDATE alerts SET delivery=? WHERE id=?").run(output.trim() || "Gửi thông báo thất bại", result.lastInsertRowid));
  child.stdin.end(JSON.stringify({
    email: b.email,
    telegram: b.telegram,
    message: `${b.name}: ${reason}`
  }));
}
async function evaluate(id) {
  const since = new Date(Date.now() - 3600000).toISOString();
  const rows = await all("SELECT c.sentiment FROM comments c JOIN posts p ON c.post_id=p.id WHERE p.brand_id=? AND p.source=? AND c.created_at>=?", id, "live", since);
  const r = crisis(rows, (await brand(id)).threshold);
  if (r.triggered) await raiseAlert(id, `${r.ratio.toFixed(1)}% bình luận tiêu cực trong 1 giờ (${r.negative}/${r.total})`);
}
const now = () => new Date().toISOString();
async function audit(ticketId, action, detail = '', actor = 'Hệ thống') {
  await db.prepare('INSERT INTO ticket_actions(ticket_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(ticketId, actor, action, detail, now());
}
async function leastBusyAssignee(queue) {
  return await db.prepare(`SELECT s.* FROM staff s
    LEFT JOIN tickets t ON t.assignee_id=s.id AND t.status IN ('open','in_progress','monitoring')
    WHERE s.role=? AND s.active=TRUE GROUP BY s.id ORDER BY COUNT(t.id),s.id LIMIT 1`).get(queue);
}
async function createTicket({ brandId, postId, commentId, score, commentText, reengaged = false }) {
  const severity = severityForRisk(score);
  if (severity.level === 'low') return null;
  const existing = await db.prepare('SELECT * FROM tickets WHERE post_id=? AND comment_id=? ORDER BY id DESC LIMIT 1').get(postId, String(commentId));
  if (existing) {
    if (reengaged && ['resolved','closed'].includes(existing.status)) {
      const dueAt = new Date(Date.now() + severity.sla_minutes * 60000).toISOString();
      await db.transaction(async () => {
        // Preserve content and publication evidence, but retire approvals from
        // the previous cycle so they cannot authorize another closure.
        await db.prepare("UPDATE ticket_responses SET status=CASE WHEN status='published' THEN 'archived_published' ELSE 'archived_approved' END WHERE ticket_id=? AND status IN ('approved','published')").run(existing.id);
        await db.prepare("UPDATE tickets SET status='open',risk_score=?,severity=?,queue=?,due_at=?,accepted_at=NULL,resolved_at=NULL,escalated_at=NULL WHERE id=?").run(score, severity.level, severity.queue, dueAt, existing.id);
        await audit(existing.id, 'reopened', `Tái bùng phát tương tác; điểm rủi ro mới ${score}/100`);
      });
      await raiseAlert(brandId, `TÁI BÙNG PHÁT · Ticket #${existing.id} được mở lại, rủi ro ${score}/100`, { force: true });
    }
    return existing;
  }
  const assignee = await leastBusyAssignee(severity.queue);
  const createdAt = now(), dueAt = new Date(Date.now() + severity.sla_minutes * 60000).toISOString();
  const result = await db.prepare('INSERT INTO tickets(brand_id,post_id,comment_id,risk_score,severity,queue,status,assignee_id,created_at,due_at,resolution_note) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(brandId, postId, String(commentId), score, severity.level, severity.queue, 'open', assignee?.id || null, createdAt, dueAt, '');
  await audit(result.lastInsertRowid, 'created', `Điểm rủi ro ${score}/100. ${commentText.slice(0, 300)}`);
  if (assignee) await audit(result.lastInsertRowid, 'assigned', `Tự động phân công cho ${assignee.name}`);
  await raiseAlert(brandId, `Ticket ${severity.level === 'critical' ? 'khủng hoảng PR' : 'CSKH'} #${result.lastInsertRowid}: rủi ro ${score}/100${assignee ? `, giao ${assignee.name}` : ', chưa có người nhận'}`);
  return { id: result.lastInsertRowid };
}
function defaultDrafts(brandName, subject) {
  return [
    `Chào bạn, ${brandName} rất tiếc vì trải nghiệm chưa như mong đợi liên quan đến “${subject.slice(0, 110)}”. Chúng mình muốn hỗ trợ bạn sớm nhất có thể—bạn vui lòng gửi thêm thông tin qua inbox để đội ngũ kiểm tra và đưa ra phương án xử lý phù hợp nhé.`,
    `Cảm ơn bạn đã chia sẻ thẳng thắn. ${brandName} hiểu sự bất tiện này và xin lỗi bạn. Để bảo vệ thông tin cá nhân, mời bạn nhắn tin riêng kèm chi tiết để chúng mình ưu tiên hỗ trợ.`,
    `Chào bạn, ${brandName} đã ghi nhận phản ánh và đang xác minh với bộ phận liên quan. Chúng mình sẽ phản hồi lại ngay khi có thông tin chính xác. Cảm ơn bạn đã kiên nhẫn.`
  ];
}
async function aiDrafts(ticket) {
  const subject = ticket.comment_text || ticket.caption || 'phản ánh của khách hàng';
  const fallback = defaultDrafts(ticket.name, subject);
  if (!process.env.OPENAI_API_KEY) return { drafts: fallback, provider: 'template' };
  const prompt = `Bạn là trợ lý chăm sóc khủng hoảng thương hiệu. Hãy tạo CHÍNH XÁC JSON array gồm 3 câu trả lời tiếng Việt ngắn, không bịa thông tin: A lịch sự có giải pháp, B thấu hiểu mời inbox riêng, C thông báo đang xác minh. Tone: chân thành, lịch sự, xin lỗi trước. Thương hiệu: ${ticket.name}. Nội dung phản ánh: ${subject.slice(0, 2000)}.`;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: prompt, max_output_tokens: 900 }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const body = await response.json();
    const text = body.output_text || body.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    const drafts = JSON.parse(String(text).replace(/^```json\s*|\s*```$/g, ''));
    if (!Array.isArray(drafts) || drafts.length !== 3 || drafts.some(x => typeof x !== 'string' || x.length > 2000)) throw new Error('Đầu ra AI không đúng định dạng');
    return { drafts, provider: 'openai' };
  } catch (error) {
    console.error('AI draft fallback:', error.message);
    return { drafts: fallback, provider: 'template_fallback' };
  }
}
async function escalateOverdueTickets() {
  const rows = await all("SELECT t.*,b.name AS brand_name FROM tickets t JOIN brands b ON b.id=t.brand_id WHERE t.status IN ('open','in_progress','monitoring') AND t.escalated_at IS NULL AND t.due_at<?", now());
  for (const ticket of rows) {
    const nextRole = ticket.queue === 'cskh' ? 'pr' : 'admin';
    const manager = await leastBusyAssignee(nextRole);
    await db.prepare('UPDATE tickets SET escalated_at=?,assignee_id=?,queue=? WHERE id=?').run(now(), manager?.id || ticket.assignee_id, nextRole, ticket.id);
    await audit(ticket.id, 'escalated', `Quá SLA; chuyển cấp tới ${manager?.name || 'quản trị viên'}`);
    await raiseAlert(ticket.brand_id, `SLA QUÁ HẠN · Ticket #${ticket.id} (${ticket.brand_name}) chưa được xử lý trước ${ticket.due_at}`, { force: true });
  }
}
app.get('/api/tickets', async (req, res) => {
  const brandId = Number(req.query.brand || 1);
  if (!(await brand(brandId))) return res.sendStatus(404);
  await escalateOverdueTickets();
  const rows = await all(`SELECT t.*,s.name AS assignee_name,p.caption,p.video_url,c.text AS comment_text,c.author AS comment_author,c.like_count
    FROM tickets t LEFT JOIN staff s ON s.id=t.assignee_id LEFT JOIN posts p ON p.id=t.post_id
    LEFT JOIN comments c ON c.post_id=t.post_id AND c.id=t.comment_id WHERE t.brand_id=? ORDER BY CASE WHEN t.escalated_at IS NOT NULL THEN 0 ELSE 1 END,t.created_at DESC`, brandId);
  res.json(rows);
});
app.get('/api/tickets/:id', async (req, res) => {
  const ticket = await db.prepare(`SELECT t.*,s.name AS assignee_name,p.caption,p.video_url,c.text AS comment_text,c.author AS comment_author,c.like_count
    FROM tickets t LEFT JOIN staff s ON s.id=t.assignee_id LEFT JOIN posts p ON p.id=t.post_id LEFT JOIN comments c ON c.post_id=t.post_id AND c.id=t.comment_id WHERE t.id=?`).get(Number(req.params.id));
  if (!ticket) return res.sendStatus(404);
  ticket.actions = await all('SELECT * FROM ticket_actions WHERE ticket_id=? ORDER BY created_at', ticket.id);
  ticket.responses = await all('SELECT * FROM ticket_responses WHERE ticket_id=? ORDER BY id DESC', ticket.id);
  res.json(ticket);
});
app.post('/api/tickets/:id/view', async (req, res) => {
  const ticket = await db.prepare('SELECT id FROM tickets WHERE id=?').get(Number(req.params.id));
  if (!ticket) return res.sendStatus(404);
  await audit(ticket.id, 'viewed', 'Nhân viên mở chi tiết ticket', typeof req.body?.actor === 'string' ? req.body.actor.slice(0, 100) : 'Nhân viên');
  res.json({ ok: true });
});
app.post('/api/tickets/:id/ai-drafts', async (req, res) => {
  const ticket = await db.prepare(`SELECT t.*,b.name,p.caption,c.text AS comment_text FROM tickets t JOIN brands b ON b.id=t.brand_id LEFT JOIN posts p ON p.id=t.post_id LEFT JOIN comments c ON c.post_id=t.post_id AND c.id=t.comment_id WHERE t.id=?`).get(Number(req.params.id));
  if (!ticket) return res.sendStatus(404);
  const result = await aiDrafts(ticket);
  await audit(ticket.id, 'ai_drafts_generated', `Đã tạo 3 phương án phản hồi (${result.provider}); cần nhân sự duyệt trước khi gửi`);
  res.json({ ...result, disclaimer: 'Bản nháp do trợ lý tạo; cần được nhân sự kiểm tra và duyệt trước khi phản hồi.' });
});
app.post('/api/tickets/:id/responses', async (req, res) => {
  const ticket = await db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id));
  const { content, actor = 'Nhân viên' } = req.body;
  if (!ticket) return res.sendStatus(404);
  if (typeof content !== 'string' || !content.trim() || content.length > 5000 || typeof actor !== 'string' || actor.length > 100) return res.status(400).json({ error: 'Nội dung duyệt không hợp lệ' });
  const result = await db.prepare('INSERT INTO ticket_responses(ticket_id,content,status,approved_by,approved_at) VALUES(?,?,?,?,?)').run(ticket.id, content.trim(), 'approved', actor, now());
  await db.prepare("UPDATE tickets SET status='in_progress',accepted_at=? WHERE id=?").run(ticket.accepted_at || now(), ticket.id);
  await audit(ticket.id, 'response_approved', 'Nhân viên đã duyệt nội dung phản hồi', actor);
  res.status(201).json({ id: result.lastInsertRowid, status: 'approved' });
});
app.post('/api/tickets/:id/responses/:responseId/publish', async (req, res) => {
  const ticket = await db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id));
  const response = await db.prepare('SELECT * FROM ticket_responses WHERE id=? AND ticket_id=?').get(Number(req.params.responseId), Number(req.params.id));
  const { mode = 'manual', published_url = '', actor = 'Nhân viên' } = req.body;
  if (!ticket || !response) return res.sendStatus(404);
  if (!['approved','published'].includes(response.status)) return res.status(409).json({ error: 'Phản hồi thuộc vòng xử lý cũ. Hãy duyệt phản hồi mới trước khi phát hành.' });
  if (!['manual','api'].includes(mode) || typeof published_url !== 'string' || published_url.length > 1000 || typeof actor !== 'string' || actor.length > 100) return res.status(400).json({ error: 'Dữ liệu phát hành không hợp lệ' });
  if (mode === 'manual' && published_url && !/^https:\/\//.test(published_url)) return res.status(400).json({ error: 'Link minh chứng phải dùng HTTPS' });
  if (mode === 'api') {
    if (!process.env.PUBLISH_WEBHOOK_URL) return res.status(409).json({ error: 'Chưa cấu hình PUBLISH_WEBHOOK_URL cho chế độ API' });
    const outgoing = await fetch(process.env.PUBLISH_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket_id: ticket.id, post_url: published_url || null, content: response.content }), signal: AbortSignal.timeout(15000) });
    if (!outgoing.ok) return res.status(502).json({ error: 'Kênh phát hành không phản hồi thành công' });
  }
  await db.prepare('UPDATE ticket_responses SET status=?,published_at=?,publish_mode=?,published_url=? WHERE id=?').run('published', now(), mode, published_url || null, response.id);
  await audit(ticket.id, 'response_published', mode === 'api' ? 'Đã gửi phản hồi qua API' : `Đã ghi nhận phát hành thủ công${published_url ? `: ${published_url}` : ''}`, actor);
  res.json({ ok: true });
});
app.patch('/api/tickets/:id', async (req, res) => {
  const ticket = await db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id));
  if (!ticket) return res.sendStatus(404);
  const { status, note = '', actor = 'Nhân viên' } = req.body;
  if (!['open','in_progress','monitoring','resolved','closed'].includes(status) || typeof note !== 'string' || note.length > 5000 || typeof actor !== 'string' || actor.length > 100) return res.status(400).json({ error: 'Dữ liệu cập nhật ticket không hợp lệ' });
  if (status === 'closed' && !(await db.prepare("SELECT id FROM ticket_responses WHERE ticket_id=? AND status='published'").get(ticket.id))) return res.status(409).json({ error: 'Cần phát hành phản hồi trước khi đóng ticket' });
  const acceptedAt = ticket.accepted_at || now();
  const resolvedAt = ['resolved','closed'].includes(status) ? now() : null;
  await db.prepare('UPDATE tickets SET status=?,accepted_at=?,resolved_at=?,resolution_note=? WHERE id=?').run(status, acceptedAt, resolvedAt, note, ticket.id);
  await audit(ticket.id, ['resolved','closed'].includes(status) ? status : status === 'monitoring' ? 'monitoring' : 'accepted', note || `Chuyển trạng thái ${status}`, actor);
  res.json({ ok: true });
});
app.get('/api/analytics/sla', async (req, res) => {
  const brandId = Number(req.query.brand || 1);
  const tickets = await all('SELECT * FROM tickets WHERE brand_id=?', brandId);
  const resolved = tickets.filter(t => t.resolved_at);
  const onTime = resolved.filter(t => Date.parse(t.resolved_at) <= Date.parse(t.due_at)).length;
  const staff = await all(`SELECT s.id,s.name,s.role,COUNT(t.id) AS handled,SUM(CASE WHEN t.resolved_at IS NOT NULL AND t.resolved_at<=t.due_at THEN 1 ELSE 0 END) AS on_time FROM staff s LEFT JOIN tickets t ON t.assignee_id=s.id AND t.brand_id=? GROUP BY s.id ORDER BY handled DESC`, brandId);
  const heatmapMap = new Map();
  for (const ticket of tickets) { const d = new Date(ticket.created_at), key = `${d.getDay()}-${d.getHours()}`; heatmapMap.set(key, (heatmapMap.get(key) || 0) + 1); }
  const heatmap = [...heatmapMap].map(([key, total]) => { const [weekday, hour] = key.split('-').map(Number); return { weekday, hour, total }; });
  res.json({ total: tickets.length, resolved: resolved.length, on_time_rate: resolved.length ? Math.round(onTime / resolved.length * 100) : 0, staff, heatmap });
});
app.patch("/api/brands/:id/channels", async (req, res) => {
  const {
    email = "",
    telegram = ""
  } = req.body;
  if (!(await brand(req.params.id))) return res.sendStatus(404);
  if (typeof email !== "string" || email.length > 254 || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof telegram !== "string" || telegram && !/^-?\d{1,30}$/.test(telegram)) return res.status(400).json({
    error: "Email hoặc Telegram Chat ID không hợp lệ"
  });
  await db.prepare("UPDATE brands SET email=?,telegram=? WHERE id=?").run(email, telegram, Number(req.params.id));
  res.json({
    ok: true
  });
});
app.get("/api/health", async (req, res) => {
  let nlp = false;
  try {
    nlp = (await fetch(`${process.env.NLP_URL || "http://127.0.0.1:8001"}/health`, {
      signal: AbortSignal.timeout(1500)
    })).ok;
  } catch {}
  await db.prepare('SELECT 1').get();
  res.json({
    api: true,
    nlp,
    database: db.kind
  });
});
app.get("/api/brands", async (req, res) => res.json(await all("SELECT * FROM brands")));
app.post("/api/brands", async (req, res) => {
  const {
    name,
    keywords,
    threshold = 40
  } = req.body;
  if (typeof name !== "string" || !name.trim() || name.length > 100 || typeof keywords !== "string" || !keywords.trim() || keywords.length > 500 || !Number.isFinite(threshold) || threshold < 1 || threshold > 100) return res.status(400).json({
    error: "Vui lòng kiểm tra tên, từ khóa và ngưỡng 1–100%"
  });
  const r = await db.prepare("INSERT INTO brands(name,keywords,threshold) VALUES(?,?,?)").run(name.trim(), keywords.trim(), threshold);
  res.status(201).json(await brand(r.lastInsertRowid));
});
app.patch("/api/brands/:id", async (req, res) => {
  const {
    threshold,
    keywords
  } = req.body;
  if (!(await brand(req.params.id))) return res.sendStatus(404);
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100 || typeof keywords !== "string" || !keywords.trim() || keywords.length > 500) return res.status(400).json({
    error: "Cấu hình không hợp lệ"
  });
  await db.prepare("UPDATE brands SET threshold=?,keywords=? WHERE id=?").run(threshold, keywords, Number(req.params.id));
  res.json({
    ok: true
  });
});
app.get("/api/dashboard", async (req, res) => {
  const id = Number(req.query.brand || 1);
  if (!(await brand(id))) return res.status(404).json({
    error: "Không tìm thấy thương hiệu"
  });
  const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const source = req.query.source === 'demo' ? 'demo' : 'live';
  res.json({
    source,
    posts: await all("SELECT * FROM posts WHERE brand_id=? AND created_at>=? AND source=? ORDER BY created_at DESC", id, since, source),
    comments: await all("SELECT c.* FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.brand_id=? AND p.created_at>=? AND p.source=?", id, since, source),
    alerts: await all("SELECT * FROM alerts WHERE brand_id=? ORDER BY created_at DESC", id),
    jobs: await all("SELECT * FROM jobs WHERE brand_id=? ORDER BY id DESC LIMIT 8", id)
  });
});
app.patch("/api/alerts/:id", async (req, res) => {
  await db.prepare("UPDATE alerts SET status='resolved' WHERE id=?").run(Number(req.params.id));
  res.json({
    ok: true
  });
});
app.post("/api/ingest", async (req, res) => {
  try {
    await crawlData.exclusive(async () => {
    if (process.env.INGEST_TOKEN && req.headers.authorization !== `Bearer ${process.env.INGEST_TOKEN}`) return res.sendStatus(401);
    const {
      brand_id,
      posts
    } = req.body;
    if (!(await brand(brand_id)) || !Array.isArray(posts) || posts.length > 30) throw new Error("Thương hiệu hoặc danh sách bài không hợp lệ");
    posts.forEach(validatePost);
    const jobId = await crawlData.validateIngest(req.body.job_id, brand_id);
    let saved = 0;
    for (const p of posts) {
      const previous = await db.prepare("SELECT * FROM posts WHERE brand_id=? AND video_id=?").get(brand_id, p.video_id);
      const comments = p.comments || [];
      const results = await analyze([p.caption, ...comments.map(c => c.text)]);
      let savedPostId;
      await db.transaction(async () => {
        const r = await db.prepare("INSERT INTO posts(video_id,brand_id,caption,author,views,likes,comment_count,video_url,sentiment,score,created_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(video_id,brand_id) DO UPDATE SET views=COALESCE(excluded.views,posts.views),likes=COALESCE(excluded.likes,posts.likes),comment_count=COALESCE(excluded.comment_count,posts.comment_count),caption=excluded.caption,sentiment=excluded.sentiment,score=excluded.score RETURNING id").get(p.video_id, brand_id, p.caption, p.author || "", p.views ?? null, p.likes ?? null, p.comment_count ?? null, p.video_url, results[0].sentiment, results[0].score, new Date().toISOString(), "live");
        savedPostId = r.id;
        await crawlData.recordPost(jobId,r.id,Boolean(previous));
        const oldComments = await db.prepare('SELECT id,like_count FROM comments WHERE post_id=?').all(r.id);
        const existingComments = new Set(oldComments.map(c=>String(c.id)));
        p._previousCommentLikes = Object.fromEntries(oldComments.map(c => [String(c.id), Number(c.like_count) || 0]));
        for (let i = 0; i < comments.length; i++) {
          const c = comments[i],
            a = results[i + 1];
          await db.prepare("INSERT INTO comments(id,post_id,text,author,sentiment,score,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id,post_id) DO UPDATE SET text=excluded.text,sentiment=excluded.sentiment,score=excluded.score").run(String(c.id), r.id, c.text, c.author || "", a.sentiment, a.score, new Date().toISOString());
          await db.prepare('UPDATE comments SET author_nickname=?,parent_id=?,like_count=?,published_at=? WHERE id=? AND post_id=?').run(c.author_nickname || null, c.parent_id || null, c.like_count ?? null, c.published_at || null, String(c.id), r.id);
          await crawlData.recordComment(jobId,r.id,String(c.id),existingComments.has(String(c.id)));
          existingComments.add(String(c.id));
        }
        await db.prepare("UPDATE posts SET observed_at=? WHERE id=?").run(new Date().toISOString(), r.id);
        await db.prepare('UPDATE posts SET published_at=COALESCE(?,published_at),collection_method=COALESCE(?,collection_method),evidence_sha256=COALESCE(?,evidence_sha256) WHERE id=?').run(p.published_at || null, p.collection_method || null, p.evidence_sha256 || null, r.id);
        await db.prepare('UPDATE posts SET author_nickname=?,hashtags=?,shares=COALESCE(?,shares),saves=COALESCE(?,saves),comment_status=?,discovery_keyword=? WHERE id=?').run(p.author_nickname || null, JSON.stringify(p.hashtags || []), p.shares ?? null, p.saves ?? null, p.comment_status || null, p.discovery_keyword || null, r.id);
      });
      for (let i = 0; i < comments.length; i++) {
        const score = riskScore({ sentiment: results[i + 1].sentiment, score: results[i + 1].score, like_count: comments[i].like_count });
        const before = p._previousCommentLikes?.[String(comments[i].id)] || 0;
        const after = Number(comments[i].like_count) || 0;
        const reengaged = after >= Math.max(50, before * 2) && after - before >= 20;
        await createTicket({ brandId: brand_id, postId: savedPostId, commentId: comments[i].id, score, commentText: comments[i].text, reengaged });
      }
      saved++;
      if (viralSpike(previous, {
        ...p,
        sentiment: results[0].sentiment
      })) await raiseAlert(brand_id, `Bài ${p.video_id} tiêu cực: tương tác tăng ít nhất gấp đôi (+100 trở lên) giữa hai lần thu thập trong 1 giờ`);
    }
    await evaluate(brand_id);
    res.json({
      saved
    });
    });
  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});
app.post("/api/crawl", async (req, res) => {
  const b = await brand(req.body.brand_id);
  if (!b) return res.status(400).json({
    error: "Thương hiệu không hợp lệ"
  });
  const urls = req.body.urls || [];
  if (!Array.isArray(urls) || urls.length > 10 || urls.some(u => typeof u !== 'string' || !/^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.]+\/video\/\d{5,30}\/?(?:\?[^\s]*)?$/.test(u))) return res.status(400).json({
    error: 'Tối đa 10 link TikTok đầy đủ dạng https://www.tiktok.com/@tacgia/video/ID'
  });
  try {
    res.status(202).json({
      id: await crawlerJobs.start(b, urls)
    });
  } catch (e) {
    res.status(409).json({
      error: e.message
    });
  }
});
await db.prepare("UPDATE jobs SET status='failed',message='Tiến trình bị gián đoạn; vui lòng chạy lại' WHERE status='running'").run();
app.post("/api/demo", async (req, res) => {
  const b = await brand(req.body.brand_id);
  if (!b) return res.sendStatus(400);
  if (await db.prepare("SELECT id FROM posts WHERE brand_id=? AND source='demo'").get(b.id)) return res.json({
    ok: true
  });
  const captions = [`Trải nghiệm ${b.name} sau một tháng: có đáng để thử?`, `Thất vọng với dịch vụ của ${b.name}, cần một câu trả lời!`, `${b.name} lần này làm quá tốt, rất hài lòng ❤️`, `Mọi người đánh giá thế nào về ${b.name}?`, `Một góc nhìn khác về chất lượng ${b.name}`, `Mình đã thử ${b.name} và đây là kết quả`, `Chờ hỗ trợ từ ${b.name} quá lâu, thật bực mình`, `Điểm cộng cho đội ngũ ${b.name}, hỗ trợ nhiệt tình`];
  for (let i = 0; i < 42; i++) {
    const sentiment = [1, 6].includes(i % 8) ? "negative" : [2, 7].includes(i % 8) ? "positive" : "neutral";
    const time = new Date(Date.now() - i * 3.7 * 3600000).toISOString();
    const r = await db.prepare("INSERT INTO posts(video_id,brand_id,caption,author,views,likes,comment_count,video_url,sentiment,score,created_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(`900000${b.id}${i.toString().padStart(4, "0")}`, b.id, captions[i % 8], ["minh.anh", "reviewcunglinh", "nguyenkhoa", "daily.chuyen"][i % 4], 12500 + i * 7919 % 180000, 450 + i * 337 % 12000, 8, "", sentiment, sentiment === "negative" ? 0.87 : 0.15, time, "demo");
    for (let j = 0; j < 8; j++) await db.prepare("INSERT INTO comments(id,post_id,text,author,sentiment,score,created_at) VALUES(?,?,?,?,?,?,?)").run(`demo-${i}-${j}`, r.lastInsertRowid, ["Rất hài lòng, chất lượng tốt", "Dịch vụ quá tệ, thất vọng", "Mình cũng đang tìm hiểu"][j % 3], "demo.user", j % 3 === 1 ? "negative" : j % 3 === 0 ? "positive" : "neutral", j % 3 === 1 ? 0.9 : 0.1, time);
  }
  res.json({
    ok: true
  });
});
app.use((err, req, res, next) => res.status(500).json({
  error: "Không xử lý được yêu cầu"
}));
const httpServer = app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () => console.log("BrandPulse API http://localhost:3001"));
const slaTimer = setInterval(() => { escalateOverdueTickets().catch(error => console.error('SLA escalation error:', error.message)); }, 60_000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  crawlerJobs.stop();
  clearInterval(slaTimer);
  httpServer.close(async () => { await db.close(); process.exit(0); });
});
