import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { backup } from 'node:sqlite';
import mysql from 'mysql2/promise';
import { mysqlConfig, createMysqlDatabase } from '../server/mysql.js';

// Source is read-only. A consistent backup includes committed WAL records.
const source = new DatabaseSync(process.env.SQLITE_PATH || 'data/brandpulse.db', { readOnly: true });
mkdirSync('data/backups', { recursive: true });
const backupPath = `data/backups/before-mysql-${Date.now()}.db`;
await backup(source, backupPath);
console.log(`SQLite backup: ${backupPath}`);
const config = mysqlConfig();
if (!/^[A-Za-z0-9_]+$/.test(config.database)) throw Error('Tên database không hợp lệ');
const admin = await mysql.createConnection(mysqlConfig({ database: false }));
try { await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
finally { await admin.end(); }
const db = await createMysqlDatabase();
const tables = ['brands','posts','comments','alerts','jobs','crawl_schedules'];
try {
  // Refuse to merge potentially unrelated IDs into an existing database.
  for (const table of tables) {
    if ((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n) throw Error(`Database đích có dữ liệu (${table}); dừng để tránh ghi đè.`);
  }
  await db.transaction(async () => {
    for (const table of tables) {
      if (!source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const keys = Object.keys(row);
        await db.prepare(`INSERT INTO ${table} (${keys.map(k => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
      }
      const count = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
      if (count !== rows.length) throw Error(`Sai số lượng bảng ${table}`);
      console.log(`${table}: ${count} bản ghi`);
    }
  });
  console.log('Đã chuyển dữ liệu sang MySQL; file SQLite gốc được giữ nguyên.');
} finally { source.close(); await db.close(); }
