// Uses its own database and ports; never modifies the developer demo workspace.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import mysql from 'mysql2/promise';
import { mysqlConfig } from '../server/mysql.js';
import { createPostgresPool, createPostgresDatabase } from '../server/postgres.js';
import { createMysqlDatabase } from '../server/mysql.js';
import { createSqliteDatabase } from '../server/sqlite.js';
import { verifyCrawlDeletion } from './crawl-data-scenarios.mjs';
const useMysql = process.argv.includes('--mysql');
const usePostgres = process.argv.includes('--postgres');
const testDatabase = `brandpulse_test_${Date.now()}_${process.pid}`;
let admin;
let pgAdmin;
if (usePostgres) {
  if (!process.env.NEON_DATABASE_URL) throw Error('Thiếu NEON_DATABASE_URL');
  pgAdmin = createPostgresPool(process.env.NEON_DATABASE_URL);
  await pgAdmin.query(`CREATE SCHEMA "${testDatabase}"`);
}
if (useMysql) {
  admin = await mysql.createConnection(mysqlConfig({ database: false }));
  await admin.query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4`);
}
const dir = mkdtempSync(join(tmpdir(), "brandpulse-test-"));
const python = spawn("python", ["python/service.py"], {
  env: { ...process.env, NLP_PORT: "18001" },
  stdio: "ignore",
});
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    DB_DRIVER: usePostgres ? 'postgres' : useMysql ? 'mysql' : 'sqlite',
    PG_SCHEMA: testDatabase,
    MYSQL_DATABASE: testDatabase,
    PORT: "13001",
    NLP_URL: "http://127.0.0.1:18001",
    DB_PATH: join(dir, "test.db"),
    INGEST_TOKEN: "integration-only",
    OPENAI_API_KEY: '',
    PUBLISH_WEBHOOK_URL: '',
  },
  stdio: "ignore",
});
const base = "http://127.0.0.1:13001/api";
async function request(path, body, method = "POST", token = true) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer integration-only" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
try {
  for (let i = 0; i < (usePostgres ? 150 : 50); i++) {
    try {
      const r = await request("/health");
      if (r.data.nlp) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await request("/health")).data.nlp, true);
  assert.equal((await request('/health')).data.database, usePostgres ? 'postgres' : useMysql ? 'mysql' : 'sqlite');
  if (usePostgres) {
    const db = await createPostgresDatabase({ schema: testDatabase });
    try {
      await assert.rejects(db.transaction(async () => {
        await db.prepare('INSERT INTO brands(name,keywords) VALUES(?,?)').run('rollback-check','rollback-check');
        throw Error('rollback expected');
      }), /rollback expected/);
      assert.equal(await db.prepare('SELECT id FROM brands WHERE name=?').get('rollback-check'), undefined);
    } finally { await db.close(); }
  }
  const b = (
    await request("/brands", {
      name: "Integration test",
      keywords: "test",
      threshold: 40,
    })
  ).data;
  const post = {
    shares:12,saves:3,hashtags:['VinFast'],author_nickname:'Test user',
    video_id: "1234567890000000000",
    caption: "Thất vọng",
    video_url: "https://www.tiktok.com/@test/video/1234567890000000000",
    views: 10,
    likes: 1,
    comments: Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      text: i < 3 ? "Thất vọng, quá tệ" : "Bài đăng mới",like_count:i,parent_id:i===4?'0':null,published_at:'2026-10-26T10:00:00Z',
    })),
  };
  assert.equal(
    (await request("/ingest", { brand_id: b.id, posts: [post] })).status,
    200,
  );
  assert.equal(
    (await request("/ingest", { brand_id: b.id, posts: [post] })).status,
    200,
  );
  let d = (await request(`/dashboard?brand=${b.id}&days=1`)).data;
  assert.equal(d.posts.length, 1);
  assert.equal(d.comments.length, 5);
  assert.equal(d.alerts.length, 1);
  assert.equal(d.posts[0].sentiment, "negative");
  assert.equal(d.posts[0].shares,12);
  assert.equal(d.posts[0].saves,3);
  assert.equal(d.comments.find(c=>c.id==='4').parent_id,'0');
  assert.equal(d.comments.find(c=>c.id==='4').like_count,4);
  const config={enabled:false,interval_minutes:60,max_posts:3,max_comments:20,max_scrolls:6};
  assert.equal((await request(`/brands/${b.id}/schedule`,config,'PUT')).status,200);
  assert.equal((await request(`/brands/${b.id}/schedule`)).data.max_posts,3);
  assert.equal((await request(`/brands/${b.id}/schedule`,{...config,max_comments:201},'PUT')).status,400);
  await request("/alerts/" + d.alerts[0].id, {}, "PATCH");
  d = (await request(`/dashboard?brand=${b.id}&days=1`)).data;
  assert.equal(d.alerts[0].status, "resolved");
  assert.equal(
    (
      await request(
        "/brands/" + b.id,
        { keywords: "updated", threshold: 55 },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/brands/" + b.id + "/channels",
        { email: "invalid" },
        "PATCH",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/ingest", {
        brand_id: b.id,
        posts: [{ ...post, views: -1 }],
      })
    ).status,
    400,
  );
  const unauthorized = await fetch(base + "/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  await request("/demo", { brand_id: 1 });
  await request("/demo", { brand_id: 1 });
  assert.equal((await request("/dashboard?brand=1&days=7")).data.posts.length,0);
  // Test the seeded demo set across its intended reporting period; a short
  // dashboard window is exercised elsewhere and should not make this fixture
  // timing-sensitive on remote PostgreSQL.
  const demo = (await request("/dashboard?brand=1&days=30&source=demo")).data;
  assert.equal(demo.posts.length, 42);
  assert.equal(demo.alerts.length, 0);
  process.env.DB_PATH=join(dir,'test.db');
  process.env.MYSQL_DATABASE=testDatabase;
  const testDb=usePostgres ? await createPostgresDatabase({schema:testDatabase}) : useMysql ? await createMysqlDatabase() : createSqliteDatabase();
  try {
    if (process.argv.includes('--workflow')) {
      const findings = [];
      const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) findings.push(name); };
      const tickets = (await request(`/tickets?brand=${b.id}`)).data;
      check('3 negative comments create 3 tickets; repeated ingest creates no duplicates', tickets.length === 3);
      const t = tickets[0];
      const path = `/tickets/${t.id}`;
      check('Cannot close before publication', (await request(path, {status:'closed'}, 'PATCH')).status === 409);
      const approved = await request(path+'/responses', {content:'BẢN THỬ NGHIỆM: Xin lỗi bạn, đội ngũ sẽ kiểm tra phản ánh.',actor:'Test CSKH'});
      check('Human approval persists response', approved.status === 201);
      await testDb.prepare('UPDATE tickets SET due_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',t.id);
      await request(`/tickets?brand=${b.id}`);
      const overdue = (await request(path)).data;
      check('Approved in_progress ticket escalates on SLA breach', Boolean(overdue.escalated_at) && overdue.queue !== t.queue);
      check('Cannot close after approval alone', (await request(path, {status:'closed'}, 'PATCH')).status === 409);
      check('Manual publication records success', (await request(`${path}/responses/${approved.data.id}/publish`, {mode:'manual',published_url:'https://example.com/test-evidence',actor:'Test CSKH'})).status === 200);
      check('Can close after publication', (await request(path,{status:'closed'},'PATCH')).status === 200);
      const surge = structuredClone(post);
      surge.comments.find(c => c.id === String(t.comment_id)).like_count = 200;
      await request('/ingest',{brand_id:b.id,posts:[surge]});
      const reopened = (await request(path)).data;
      check('Engagement surge reopens same ticket and records audit', reopened.status === 'open' && reopened.actions.some(a=>a.action==='reopened'));
      check('Reopened cycle cannot close using previous publication', (await request(path,{status:'closed'},'PATCH')).status === 409);
      check('Cannot republish previous cycle response', (await request(`${path}/responses/${approved.data.id}/publish`, {mode:'manual'})).status === 409);
      check('Previous publication evidence retained', reopened.responses.some(r => r.id == approved.data.id && r.status === 'archived_published' && r.published_at));
      const next = await request(path+'/responses', {content:'Phản hồi mới cho vòng tái bùng phát',actor:'Test PR'});
      check('New approval alone still cannot close', next.status === 201 && (await request(path,{status:'closed'},'PATCH')).status === 409);
      check('New cycle publication allows closure', (await request(`${path}/responses/${next.data.id}/publish`,{mode:'manual'})).status === 200 && (await request(path,{status:'closed'},'PATCH')).status === 200);
      console.log(`WORKFLOW RESULT: ${findings.length} failed checks: ${findings.join('; ')}`);
      if (findings.length) process.exitCode = 1;
    }
    await verifyCrawlDeletion(testDb,request,b.id,post);
  }
  finally { await testDb.close(); }
  console.log(
    "PASS: NLP pipeline, ingestion, deduplication, crisis threshold, cooldown, resolve, settings, validation, token and demo isolation.",
  );
} finally {
  const stop = (child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    child.once("close", resolve);
    child.kill();
  });
  await Promise.all([stop(server), stop(python)]);
  rmSync(dir, { recursive: true, force: true });
  if (admin) {
    await admin.query(`DROP DATABASE \`${testDatabase}\``);
    await admin.end();
  }
  if (pgAdmin) {
    await pgAdmin.query(`DROP SCHEMA "${testDatabase}" CASCADE`);
    await pgAdmin.end();
  }
}
