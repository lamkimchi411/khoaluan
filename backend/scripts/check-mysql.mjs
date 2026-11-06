import mysql from 'mysql2/promise';
import { mysqlConfig } from '../server/mysql.js';
const connection = await mysql.createConnection(mysqlConfig());
try {
  const [rows] = await connection.query('SELECT DATABASE() AS db, VERSION() AS version');
  console.log(rows[0]);
  for (const table of ['brands','posts','comments','alerts','jobs','crawl_schedules']) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM ${table}`);
    console.log(`${table}: ${rows[0].total}`);
  }
} finally { await connection.end(); }
