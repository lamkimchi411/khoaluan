import { createPostgresPool } from '../server/postgres.js';
if (!process.env.NEON_DATABASE_URL) throw Error('Thiếu NEON_DATABASE_URL');
const pool = createPostgresPool(process.env.NEON_DATABASE_URL);
try {
  for (const table of ['brands','posts','comments','alerts','jobs','crawl_schedules']) {
    console.log(`${table}: ${(await pool.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count}`);
  }
  console.log('Kết nối Neon thành công với TLS xác minh chứng chỉ.');
} finally { await pool.end(); }
