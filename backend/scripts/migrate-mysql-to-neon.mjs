import mysql from 'mysql2/promise';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mysqlConfig } from '../server/mysql.js';
import { createPostgresDatabase } from '../server/postgres.js';

if (!process.env.NEON_DATABASE_URL) throw Error('Thiếu NEON_DATABASE_URL; chưa thay đổi database nào.');
const tables = ['brands','posts','comments','alerts','jobs','crawl_schedules'];
const source = await mysql.createConnection(mysqlConfig());
let target;
try {
  await source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const snapshot = {};
  for (const table of tables) snapshot[table] = (await source.query(`SELECT * FROM ${table}`))[0];
  await source.commit();
  if (snapshot.jobs.some(job => job.status === 'running')) throw Error('Có crawler đang chạy. Chờ hoàn tất và dừng backend trước khi chuyển.');
  mkdirSync('data/backups', { recursive: true });
  const backupPath = `data/backups/before-neon-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  console.log(`Bản sao MySQL: ${backupPath}`);
  target = await createPostgresDatabase({ url: process.env.NEON_DATABASE_URL });
  await target.transaction(async () => {
    // Serialize migration attempts and refuse to overwrite any existing records.
    await target.exec(`LOCK TABLE ${tables.join(',')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of tables) {
      if (Number((await target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count)) throw Error(`Neon đã có dữ liệu trong ${table}; dừng để tránh ghi đè.`);
    }
    for (const table of tables) {
      const rows = snapshot[table];
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        const keys = Object.keys(batch[0]);
        const values = batch.flatMap(row => keys.map(key => key === 'enabled' ? Boolean(row[key]) : /_at$/.test(key) && row[key] === '' ? null : row[key]));
        const tuples = batch.map(() => `(${keys.map(() => '?').join(',')})`).join(',');
        await target.prepare(`INSERT INTO ${table} (${keys.map(key => `"${key}"`).join(',')}) VALUES ${tuples}`).run(...values);
      }
      const count = Number((await target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count);
      if (count !== rows.length) throw Error(`Sai số lượng bảng ${table}`);
      const keyOf = row => table === 'comments' ? JSON.stringify([row.id,String(row.post_id)]) : String(row.id ?? row.brand_id);
      const copied = new Map((await target.prepare(`SELECT * FROM ${table}`).all()).map(row => [keyOf(row),row]));
      const normalized = (key,value) => key === 'enabled' ? Boolean(value) : /_at$/.test(key) ? (value ? new Date(value).toISOString() : null) : value;
      for (const row of rows) {
        const actual = copied.get(keyOf(row));
        if (!actual || Object.keys(row).some(key => normalized(key,row[key]) !== normalized(key,actual[key]))) throw Error(`Dữ liệu bảng ${table} không khớp; rollback migration.`);
      }
      if (!['comments','crawl_schedules'].includes(table)) await target.exec(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1), EXISTS(SELECT 1 FROM ${table}))`);
      console.log(`${table}: ${count} bản ghi`);
    }
  });
  console.log('Đã sao chép MySQL sang Neon. Chỉ chuyển DB_DRIVER=postgres sau khi kiểm tra; nguồn MySQL giữ nguyên.');
} finally { await source.end(); await target?.close(); }
