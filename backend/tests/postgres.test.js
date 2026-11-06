import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql, normalizePostgresRow, createPostgresPool } from '../server/postgres.js';

test('PostgreSQL placeholders preserve question marks in quoted SQL and adapt schedule boolean', () => {
  assert.equal(postgresSql("SELECT '?' AS text FROM crawl_schedules s WHERE s.enabled=1 AND brand_id=? AND next_run_at<=?"), "SELECT '?' AS text FROM crawl_schedules s WHERE s.enabled=true AND brand_id=$1 AND next_run_at<=$2");
});
test('PostgreSQL rows preserve TikTok comment IDs and API date/number types', () => {
  const row = normalizePostgresRow({id:'7701701504654118164', post_id:'17', like_count:'3', created_at:new Date('2026-10-28T00:00:00Z')});
  assert.deepEqual(row, {id:'7701701504654118164',post_id:17,like_count:3,created_at:'2026-10-28T00:00:00.000Z'});
  assert.equal(normalizePostgresRow({id:'17',brand_id:'1'}).id,17);
  assert.throws(() => normalizePostgresRow({id:'9007199254740993'}));
});
test('Connection strings cannot disable certificate verification', async () => {
  const pool = createPostgresPool('postgresql://example:example@example.invalid/test?sslmode=disable');
  assert.equal(pool.options.ssl.rejectUnauthorized,true);
  assert.equal(new URL(pool.options.connectionString).searchParams.has('sslmode'),false);
  await pool.end();
});
