import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Thiếu DATABASE_URL trong backend/.env');
const sqlite = new DatabaseSync(process.env.SQLITE_PATH || 'data/brandpulse.db', { readOnly: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const tables = ['brands', 'posts', 'comments', 'alerts', 'jobs', 'crawl_schedules'];
const conflictColumns = { brands: ['id'], posts: ['video_id', 'brand_id'], comments: ['id', 'post_id'], alerts: ['id'], jobs: ['id'], crawl_schedules: ['brand_id'] };

try {
  await client.query('BEGIN');
  await client.query(readFileSync(new URL('../sql/schema.postgres.sql', import.meta.url), 'utf8'));
  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const columns = keys.map(k => `"${k}"`).join(',');
    const conflict = conflictColumns[table];
    const updates = keys.filter(k => !conflict.includes(k)).map(k => `"${k}"=EXCLUDED."${k}"`).join(',');
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      const values = [];
      const tuples = batch.map((row, rowIndex) => `(${keys.map((k, columnIndex) => {
        values.push(k === 'enabled' ? Boolean(row[k]) : row[k] === '' && /_at$/.test(k) ? null : row[k]);
        return `$${rowIndex * keys.length + columnIndex + 1}`;
      }).join(',')})`).join(',');
      await client.query(`INSERT INTO ${table} (${columns}) VALUES ${tuples} ON CONFLICT (${conflict.join(',')}) DO UPDATE SET ${updates || `${conflict[0]}=EXCLUDED.${conflict[0]}`}`, values);
    }
    if (table !== 'comments' && table !== 'crawl_schedules') await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`);
    console.log(`${table}: ${rows.length} bản ghi`);
  }
  await client.query('COMMIT');
  console.log('Đã chuyển dữ liệu SQLite sang PostgreSQL.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  sqlite.close(); client.release(); await pool.end();
}
