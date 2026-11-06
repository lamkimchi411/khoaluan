import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';

export function mysqlConfig({ database = true } = {}) {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    ...(database ? { database: process.env.MYSQL_DATABASE || 'brandpulse' } : {}),
    charset: 'utf8mb4', decimalNumbers: true, connectTimeout: 10000,
  };
}

// Keep the application's parameterized SQL interface; translate only its upserts.
export function mysqlSql(sql) {
  const returning = /RETURNING id\s*$/i.test(sql);
  return sql.replace(/\s+RETURNING id\s*$/i, '')
    .replace(/ON CONFLICT\([^)]+\) DO UPDATE SET /gi,
      `ON DUPLICATE KEY UPDATE ${returning ? 'id=LAST_INSERT_ID(id), ' : ''}`)
    .replace(/excluded\.(\w+)/gi, 'VALUES($1)');
}

export async function createMysqlDatabase() {
  const pool = mysql.createPool({ ...mysqlConfig(), connectionLimit: 10 });
  const context = new AsyncLocalStorage();
  const query = async (sql, args = []) => (await (context.getStore() || pool).query(mysqlSql(sql), args))[0];
  const db = {
    kind: 'mysql',
    prepare(sql) {
      return {
        all: (...args) => query(sql, args),
        async get(...args) {
          const rows = await query(sql, args);
          return /RETURNING id\s*$/i.test(sql) ? { id: rows.insertId } : rows[0];
        },
        async run(...args) {
          const result = await query(sql, args);
          return { lastInsertRowid: result.insertId, changes: result.affectedRows };
        },
      };
    },
    exec: sql => query(sql),
    async transaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await context.run(connection, work);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    },
    close: () => pool.end(),
  };
  try {
    for (const sql of readFileSync(new URL('../sql/schema.mysql.sql', import.meta.url), 'utf8').split(';').filter(s => s.trim())) await db.exec(sql);
    return db;
  } catch (error) { await pool.end(); throw error; }
}
